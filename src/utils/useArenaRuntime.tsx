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

  const offRef = useRef<() => void>();
  const stopPresenceRef = useRef<() => Promise<void>>();
  const stopWriterRef = useRef<() => void>();

  // Boot: auth → ensure arena docs → start presence
  useEffect(() => {
    let cancelled = false;

    setBootError(null);
    setPresenceId(undefined);

    if (!arenaId) {
      setBootError("no-arena-id");
      return () => {};
    }

    (async () => {
      console.info("[ARENA] boot", { arenaId });
      try {
        await ensureAnonAuth();
        await ensureArenaFixed(arenaId);
        if (cancelled) return;

        const { presenceId: myPresenceId, stop } = await startPresence(arenaId, playerId, profile);
        if (cancelled) {
          await stop();
          return;
        }
        setPresenceId(myPresenceId);
        stopPresenceRef.current = stop;

        console.info("[ARENA] boot-ready", { arenaId, presenceId: myPresenceId });
        setBootError(null);
      } catch (e: any) {
        const msg = typeof e?.message === "string" ? e.message : String(e);
        console.error("[ARENA] boot-failed", { message: msg });
        if (!cancelled) setBootError(msg);
      }
    })();

    return () => {
      cancelled = true;
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

  // Debounced roster stability (for UI only)
  useEffect(() => {
    const t = setTimeout(() => {
      const ok = live.length >= 2;
      console.info("[PRESENCE] roster stable", { count: live.length, ids: live.map(p => p.id) });
      setStable(ok);
    }, WAIT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [live]);

  // Writer election (lexicographically smallest presenceId)
  useEffect(() => {
    if (!arenaId || !presenceId) return;

    const leader = [...live].map(p => p.id).sort()[0];
    const amWriter = leader && leader === presenceId;

    if (!amWriter) {
      if (stopWriterRef.current) {
        stopWriterRef.current();
        stopWriterRef.current = undefined;
      }
      return;
    }

    // Start/replace host loop @12 Hz
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
  }, [arenaId, presenceId, JSON.stringify(live.map(p => p.id).sort())]);

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

  return { presenceId, live, stable, enqueueInput, bootError };
}
