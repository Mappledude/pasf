import { useEffect, useMemo, useRef, useState } from "react";
import { ensureAnonAuth } from "../auth/ensureAnonAuth";
import { startPresence } from "../arena/presence";
import { ensureArenaFixed } from "../lib/arenaRepo";
import { watchArenaPresence, type LivePresence } from "../firebase";
import { writeArenaInput } from "../net/ActionBus";
import { startHostLoop } from "../game/net/hostLoop";
import { pullAllInputs, writeStateSnapshot, stepSimFrame, resetArenaSim } from "../game/net/plumbing";

const WAIT_DEBOUNCE_MS = 2000;
const WRITER_ELECTION_DEBOUNCE_MS = 300;

export function useArenaRuntime(
  arenaId?: string,
  playerId?: string,
  profile?: { displayName?: string }
) {
  const [presenceId, setPresenceId] = useState<string>();
  const [live, setLive] = useState<LivePresence[]>([]);
  const [stable, setStable] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [nextRetryAt, setNextRetryAt] = useState<number | undefined>(undefined);
  const [lastBootErrorAt, setLastBootErrorAt] = useState<number | null>(null);
  const [probeWarning, setProbeWarning] = useState(false);

  const offRef = useRef<() => void>();
  const stopPresenceRef = useRef<() => Promise<void>>();
  const stopWriterRef = useRef<() => void>();
  const writerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Boot with retry: auth → start presence (first) → try seeding arena (non-fatal)
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    };

    const resetRuntime = () => {
      setPresenceId(undefined);
      setProbeWarning(false);
      // stop presence heartbeat if running
      const stopPresence = stopPresenceRef.current;
      stopPresenceRef.current = undefined;
      if (stopPresence) {
        stopPresence().catch((err) => {
          console.error("[ARENA] presence-stop-failed", { message: String(err?.message ?? err) });
        });
      }
      // stop writer loop if running
      if (stopWriterRef.current) {
        stopWriterRef.current();
        stopWriterRef.current = undefined;
      }
    };

    const boot = async () => {
      attempt += 1;
      const attemptInfo = { arenaId, attempt };
      setNextRetryAt(undefined);
      console.info("[ARENA] boot", attemptInfo);

      try {
        if (!arenaId) {
          throw new Error("no-arena-id");
        }

        // 1) Ensure auth
        setBootError(null);
        setProbeWarning(false);
        await ensureAnonAuth();
        if (cancelled) return;

        // 2) Seed arena docs / probe rules (non-fatal on permission)
        let nonFatalProbe = false;
        try {
          const result = await ensureArenaFixed(arenaId);
          nonFatalProbe = Boolean(result?.probeWarning);
          console.info("[ARENA] seeded", { arenaId });
        } catch (seedErr: any) {
          const code = seedErr?.code ?? seedErr?.name;
          const message = String(seedErr?.message ?? seedErr);
          if (code === "permission-denied") {
            nonFatalProbe = true;
            console.warn("[ARENA] rules-probe non-fatal", { arenaId, code, message });
          } else {
            throw seedErr;
          }
        }
        if (cancelled) return;
        setProbeWarning(nonFatalProbe);

        // 3) Start presence once seeding completes (or is skipped)
        const { presenceId: myPresenceId, stop } = await startPresence(arenaId, playerId, profile);
        if (cancelled) {
          await stop();
          return;
        }
        setPresenceId(myPresenceId);
        setBootError(null);
        setLastBootErrorAt(null);
        setNextRetryAt(undefined);
        stopPresenceRef.current = stop;
        console.info("[PRESENCE] started", { arenaId, presenceId: myPresenceId });

        if (cancelled) {
          return;
        }

        console.info("[ARENA] boot-ready", { arenaId, presenceId: myPresenceId });
      } catch (e: any) {
        if (cancelled) return;
        const message = String(e?.message ?? e ?? "unknown-error");
        setBootError(message);
        setLastBootErrorAt(Date.now());

        // Reset any partial state and schedule a retry with backoff
        resetRuntime();
        const retryMs = Math.min(30000, 2000 * attempt); // 2s, 4s, 8s, ... capped at 30s
        const when = Date.now() + retryMs;
        setNextRetryAt(when);

        console.error("[ARENA] boot-failed", { ...attemptInfo, message });
        console.info("[ARENA] boot-retry", { ...attemptInfo, retryMs });

        clearRetryTimer();
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (!cancelled) {
            void boot();
          }
        }, retryMs);
      }
    };

    resetRuntime();
    void boot();

    return () => {
      cancelled = true;
      clearRetryTimer();

      const stopPresence = stopPresenceRef.current;
      stopPresenceRef.current = undefined;
      if (stopPresence) {
        void stopPresence();
      }
    };
  }, [arenaId, playerId, profile]);

  // Presence watcher
  useEffect(() => {
    if (!arenaId) {
      setLive([]);
      offRef.current?.();
      offRef.current = undefined;
      return () => {};
    }
    offRef.current?.();
    offRef.current = watchArenaPresence(arenaId, setLive);
    return () => {
      offRef.current?.();
      offRef.current = undefined;
    };
  }, [arenaId]);

  // Debounced roster stability (UI only)
  useEffect(() => {
    const t = setTimeout(() => {
      const ok = live.length >= 2;
      console.info("[PRESENCE] roster stable", { count: live.length, ids: live.map((p) => p.id) });
      setStable(ok);
    }, WAIT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [live]);

  // Writer election (lexicographically smallest presenceId)
  useEffect(() => {
    const clearTimer = () => {
      if (writerDebounceRef.current) {
        clearTimeout(writerDebounceRef.current);
        writerDebounceRef.current = null;
      }
    };

    clearTimer();

    if (!arenaId || !presenceId) {
      stopWriterRef.current?.();
      stopWriterRef.current = undefined;
      return clearTimer;
    }

    const rosterIds = live.map((p) => p.id);

    writerDebounceRef.current = setTimeout(() => {
      const leader = [...rosterIds].sort()[0];
      const amWriter = Boolean(leader && leader === presenceId);

      if (!amWriter) {
        if (stopWriterRef.current) {
          stopWriterRef.current();
          stopWriterRef.current = undefined;
        }
        return;
      }

      stopWriterRef.current?.();
      stopWriterRef.current = startHostLoop({
        arenaId,
        isWriter: () => true,
        getLivePresence: () => live,
        pullInputs: () => pullAllInputs(arenaId),
        stepSim: (dt, inputs) => stepSimFrame(arenaId, dt, inputs, live),
        writeState: () => writeStateSnapshot(arenaId),
      });
      console.info("[WRITER] elected", { presenceId, arenaId });
    }, WRITER_ELECTION_DEBOUNCE_MS);

    return clearTimer;
  }, [arenaId, presenceId, live]);

  // Input enqueue bound to current presence
  const enqueueInput = useMemo(() => {
    if (!arenaId || !presenceId) {
      return async (_: any) => {};
    }
    return async (payload: any) => {
      await writeArenaInput(arenaId, presenceId, payload);
    };
  }, [arenaId, presenceId]);

  // Cleanup on arena change/unmount
  useEffect(() => {
    if (!arenaId) return () => {};
    return () => {
      stopWriterRef.current?.();
      if (stopPresenceRef.current) void stopPresenceRef.current();
      resetArenaSim(arenaId);
    };
  }, [arenaId]);

  return {
    presenceId,
    live,
    stable,
    enqueueInput,
    bootError,
    lastBootErrorAt,
    nextRetryAt,
    probeWarning,
  };
}
