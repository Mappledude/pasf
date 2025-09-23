import { useEffect, useMemo, useRef, useState } from "react";
import { ensureAnonAuth } from "../auth/ensureAnonAuth";
import { startPresence } from "../arena/presence";
import { ensureArenaFixed } from "../lib/arenaRepo";
import {
  auth,
  claimArenaWriter,
  renewArenaWriterLease,
  watchArenaPresence,
  watchArenaState,
  type LivePresence,
} from "../firebase";
import { writeArenaInput } from "../net/ActionBus";
import { startHostLoop } from "../game/net/hostLoop";
import { pullAllInputs, writeStateSnapshot, stepSimFrame, resetArenaSim } from "../game/net/plumbing";

const WAIT_DEBOUNCE_MS = 2000;
const WRITER_ELECTION_DEBOUNCE_MS = 300;
const WRITER_LEASE_REFRESH_MS = 250;
const WRITER_LEASE_GRACE_MS = 800;

const toMillis = (value: unknown): number => {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch (error) {
      console.warn("[WRITER] lease toMillis failed", error);
      return 0;
    }
  }
  return 0;
};

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
  const [displayName, setDisplayName] = useState<string | undefined>(undefined);
  const [writerMeta, setWriterMeta] = useState<{ writerUid: string | null; writerLeaseUpdatedAt?: number }>({
    writerUid: null,
    writerLeaseUpdatedAt: undefined,
  });

  const offRef = useRef<() => void>();
  const stopPresenceRef = useRef<() => Promise<void>>();
  const stopWriterRef = useRef<() => void>();
  const writerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writerLeaseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const writerClaimRef = useRef<Promise<boolean> | null>(null);
  const writerClaimAttemptRef = useRef<number>(0);

  const clearWriterLeaseInterval = () => {
    if (writerLeaseIntervalRef.current) {
      clearInterval(writerLeaseIntervalRef.current);
      writerLeaseIntervalRef.current = null;
    }
    writerClaimAttemptRef.current = 0;
  };

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
      setDisplayName(undefined);
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
      clearWriterLeaseInterval();
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
        const { presenceId: myPresenceId, stop, displayName: resolvedDisplayName } =
          await startPresence(arenaId, playerId, profile);
        if (cancelled) {
          await stop();
          return;
        }
        setPresenceId(myPresenceId);
        setDisplayName(resolvedDisplayName);
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
      setDisplayName(undefined);
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

  useEffect(() => {
    if (!arenaId) {
      setWriterMeta({ writerUid: null, writerLeaseUpdatedAt: undefined });
      return () => {};
    }

    const unsubscribe = watchArenaState(arenaId, (state) => {
      const record = (state ?? {}) as Record<string, unknown>;
      const writerUid = typeof record.writerUid === "string" ? record.writerUid : null;
      const leaseMs = toMillis(record.writerLeaseUpdatedAt);
      setWriterMeta({
        writerUid,
        writerLeaseUpdatedAt: leaseMs > 0 ? leaseMs : undefined,
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, [arenaId]);

  // Debounced roster stability (UI only)
  useEffect(() => {
    const t = setTimeout(() => {
      const ok = live.length >= 2;
      console.info("[PRESENCE] roster stable", {
        count: live.length,
        ids: live.map((p) => p.uid || p.id),
      });
      setStable(ok);
    }, WAIT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [live]);

  // Writer election (lexicographically smallest auth uid)
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
      clearWriterLeaseInterval();
      return clearTimer;
    }

    const localUid = auth.currentUser?.uid ?? null;
    if (!localUid) {
      stopWriterRef.current?.();
      stopWriterRef.current = undefined;
      clearWriterLeaseInterval();
      return clearTimer;
    }

    const rosterUids = live
      .map((p) => p.uid || p.authUid || p.id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    writerDebounceRef.current = setTimeout(() => {
      const electedUid = rosterUids.length ? [...rosterUids].sort()[0] : undefined;
      const leaseMs = writerMeta.writerLeaseUpdatedAt ?? 0;
      const leaseAge = leaseMs > 0 ? Date.now() - leaseMs : Number.POSITIVE_INFINITY;
      const leaseFresh = writerMeta.writerUid === localUid && leaseAge <= WRITER_LEASE_GRACE_MS;

      console.info("[WRITER] election", { arenaId, electedUid, localUid, leaseAge });

      if (!electedUid || electedUid !== localUid) {
        if (stopWriterRef.current) {
          stopWriterRef.current();
          stopWriterRef.current = undefined;
        }
        clearWriterLeaseInterval();
        return;
      }

      if (!leaseFresh) {
        const now = Date.now();
        if (
          !writerClaimRef.current &&
          leaseAge > WRITER_LEASE_GRACE_MS &&
          now - writerClaimAttemptRef.current >= WRITER_ELECTION_DEBOUNCE_MS
        ) {
          writerClaimAttemptRef.current = now;
          console.info("[WRITER] claim-attempt", { arenaId, electedUid, localUid, leaseAge });
          writerClaimRef.current = claimArenaWriter(arenaId, localUid)
            .then((claimed) => {
              console.info("[WRITER] claim-result", { arenaId, localUid, claimed });
              return claimed;
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              console.error("[WRITER] claim-failed", { arenaId, localUid, message });
              return false;
            })
            .finally(() => {
              writerClaimRef.current = null;
            });
        }
        if (stopWriterRef.current) {
          stopWriterRef.current();
          stopWriterRef.current = undefined;
        }
        clearWriterLeaseInterval();
        return;
      }

      if (!stopWriterRef.current) {
        stopWriterRef.current = startHostLoop({
          arenaId,
          isWriter: () => true,
          getLivePresence: () => live,
          pullInputs: () => pullAllInputs(arenaId),
          stepSim: (dt, inputs) => stepSimFrame(arenaId, dt, inputs, live),
          writeState: () => writeStateSnapshot(arenaId),
        });
      }

      if (!writerLeaseIntervalRef.current) {
        writerLeaseIntervalRef.current = setInterval(() => {
          void renewArenaWriterLease(arenaId, localUid).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[WRITER] lease-renew-failed", { arenaId, localUid, message });
          });
        }, WRITER_LEASE_REFRESH_MS);
      }

      console.info("[WRITER] elected", { arenaId, electedUid, localUid });
    }, WRITER_ELECTION_DEBOUNCE_MS);

    return clearTimer;
  }, [arenaId, presenceId, live, writerMeta]);

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
      clearWriterLeaseInterval();
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
    displayName,
  };
}
