import { useEffect, useMemo, useRef, useState } from "react";
import { ensureAnonAuth } from "../auth/ensureAnonAuth";
import { startPresence } from "../arena/presence";
import { watchArenaPresence, type LivePresence } from "../firebase";
import { writeArenaInput } from "../net/ActionBus";
import { startHostLoop } from "../game/net/hostLoop";
import { pullAllInputs, writeStateSnapshot, stepSimFrame, resetArenaSim } from "../game/net/plumbing";

const WAIT_DEBOUNCE_MS = 2000;

export function useArenaRuntime(arenaId: string, playerId?: string, profile?: { displayName?: string }) {
  const [presenceId, setPresenceId] = useState<string>();
  const [live, setLive] = useState<LivePresence[]>([]);
  const [stable, setStable] = useState(false);
  const offRef = useRef<() => void>();
  const stopPresenceRef = useRef<() => Promise<void>>();
  const stopWriterRef = useRef<() => void>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureAnonAuth();
      if (cancelled) return;
      const { presenceId: myPresenceId, stop } = await startPresence(arenaId, playerId, profile);
      if (cancelled) {
        await stop();
        return;
      }
      setPresenceId(myPresenceId);
      stopPresenceRef.current = stop;
    })();
    return () => {
      cancelled = true;
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

  return { presenceId, live, stable, enqueueInput };
}
