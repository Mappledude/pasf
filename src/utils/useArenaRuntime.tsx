import { useEffect, useMemo, useRef, useState } from "react";
import { ensureAnonAuth } from "../auth/ensureAnonAuth";
import { startPresence } from "../arena/presence";
import { ensureArenaFixed } from "../lib/arenaRepo";
import { watchArenaPresence, type LivePresence } from "../firebase";
import { writeArenaInput } from "../net/ActionBus";
import { startHostLoop } from "../game/net/hostLoop";
import { pullAllInputs, writeStateSnapshot, stepSimFrame, resetArenaSim } from "../game/net/plumbing";

const WAIT_DEBOUNCE_MS = 2000;

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

  const offRef = useRef<() => void>();
  const stopPresenceRef = useRef<() => Promise<void>>();
  const stopWriterRef = useRef<() => void>();

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
      setBootError(null);
      setNextRetryAt(undefined);
      console.info("[ARENA] boot", attemptInfo);

      try {
        if (!arenaId) {
          throw new Error("no-arena-id");
        }

        // 1) Ensure auth
        await ensureAnonAuth();
        if (cancelled) return;

        // 2) Start presence FIRST (so roster shows even if seeding fails)
        const { presenceId: myPresenceId, stop } = await startPresence(arenaId, playerId, profile);
        if (cancelled) {
          await stop();
          return;
        }
        setPresenceId(myPresenceId);
        stopPresenceRef.current = stop;
        console.info("[PRESENCE] started", { arenaId, presenceId: myPresenceId });

        // 3) Try to seed arena docs; do not fail boot if this is blocked by rules
        try {
          await ensureArenaFixed(arenaId);
          console.info("[ARENA] seeded", { arenaId });
        } catch (seedErr: any) {
          console.warn("[ARENA] seed-skipped", { message: String(seedErr?.message ?? seedErr) });
        }

        setBootError(null);
        setNextRetryAt(undefined);
        console.info("[ARENA] boot-ready", { arenaId, presenceId: myPresenceId });
      } catch (e: any) {
        if (cancelled) return;
        const message = String(e?.message ?? e ?? "unknown-error");
        setBootError(message);

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
    if (!arenaId || !presenceId) return;

    const leader = [...live].map((p) => p.id).sort()[0];
    const amWriter = leader && leader === presenceId;

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

    return () => {
      stopWriterRef.current?.();
      stopWriterRef.current = undefined;
    };
  }, [arenaId, presenceId, JSON.stringify(live.map((p) => p.id).sort())]);

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

  return { presenceId, live, stable, enqueueInput, bootError, nextRetryAt };
}
