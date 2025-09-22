import { useEffect, useMemo, useRef, useState } from "react";
import { ensureAnonAuth } from "../auth/ensureAnonAuth";
import { startPresence } from "../arena/presence";
import { ensureArenaFixed } from "../lib/arenaRepo";
import { watchArenaPresence, type LivePresence } from "../firebase";
import { writeArenaInput } from "../net/ActionBus";
import { startHostLoop } from "../game/net/hostLoop";
import { pullAllInputs, writeStateSnapshot, stepSimFrame, resetArenaSim } from "../game/net/plumbing";

const WAIT_DEBOUNCE_MS = 2000;

export function useArenaRuntime(arenaId: string, playerId?: string, profile?: { displayName?: string }) {
  const [presenceId, setPresenceId] = useState<string>();
  const [live, setLive] = useState<LivePresence[]>([]);
  const [stable, setStable] = useState(false);
  const [bootError, setBootError] = useState<string>();
  const [nextRetryAt, setNextRetryAt] = useState<number>();
  const offRef = useRef<() => void>();
  const stopPresenceRef = useRef<() => Promise<void>>();
  const stopWriterRef = useRef<() => void>();

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const resetRuntime = () => {
      setPresenceId(undefined);
      const stopPresence = stopPresenceRef.current;
      stopPresenceRef.current = undefined;
      if (stopPresence) {
        stopPresence().catch((err) => {
          console.error("[ARENA] presence-stop-failed", { message: String(err?.message ?? err) });
        });
      }
      if (stopWriterRef.current) {
        stopWriterRef.current();
        stopWriterRef.current = undefined;
      }
    };

    const boot = async () => {
      attempt += 1;
      const attemptInfo = { arenaId, attempt };
      console.info("[ARENA] boot", attemptInfo);
      try {
        await ensureAnonAuth();
        await ensureArenaFixed(arenaId);
        if (cancelled) return;
        const { presenceId: myPresenceId, stop } = await startPresence(arenaId, playerId, profile);
        if (cancelled) {
          await stop();
          return;
        }
        setBootError(undefined);
        setNextRetryAt(undefined);
        setPresenceId(myPresenceId);
        stopPresenceRef.current = stop;
      } catch (e: any) {
        if (cancelled) return;
        const message = String(e?.message ?? e ?? "unknown-error");
        setBootError(message);
        resetRuntime();
        const retryMs = Math.min(30000, 2000 * attempt);
        const retryAt = Date.now() + retryMs;
        setNextRetryAt(retryAt);
        console.error("[ARENA] boot-failed", { ...attemptInfo, message });
        console.info("[ARENA] boot-retry", { ...attemptInfo, retryMs });
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (cancelled) return;
          boot().catch((err) => {
            console.error("[ARENA] boot-retry-failed", { message: String(err?.message ?? err) });
          });
        }, retryMs);
      }
    };

    resetRuntime();
    boot().catch((err) => {
      const message = String(err?.message ?? err ?? "unknown-error");
      console.error("[ARENA] boot-failed", { arenaId, message });
      setBootError(message);
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [arenaId, playerId, profile]);

  useEffect(() => {
    offRef.current?.();
    offRef.current = watchArenaPresence(arenaId, setLive);
    return () => {
      offRef.current?.();
      offRef.current = undefined;
    };
  }, [arenaId]);

  useEffect(() => {
    const t = setTimeout(() => {
      const ok = live.length >= 2;
      console.info("[PRESENCE] roster stable", { count: live.length, ids: live.map((p) => p.id) });
      setStable(ok);
    }, WAIT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [live]);

  useEffect(() => {
    if (!presenceId) return;
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

  const enqueueInput = useMemo(() => {
    return async (payload: any) => {
      if (!presenceId) return;
      await writeArenaInput(arenaId, presenceId, payload);
    };
  }, [arenaId, presenceId]);

  useEffect(() => {
    return () => {
      stopWriterRef.current?.();
      if (stopPresenceRef.current) void stopPresenceRef.current();
      resetArenaSim(arenaId);
    };
  }, [arenaId]);

  return { presenceId, live, stable, enqueueInput, bootError, nextRetryAt };
}
