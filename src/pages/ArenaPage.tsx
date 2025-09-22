import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import {
  auth,
  db,
  ensureAnonAuth,
  heartbeatArenaPresence,
  joinArena,
  leaveArena,
  watchLeaderboard,
} from "../firebase";
import type { LeaderboardEntry } from "../firebase";

import { ARENA_NET_DEBUG, debugLog } from "../net/debug";

import {
  ensureArenaState,
  watchArenaState,
  touchPlayer,
} from "../lib/arenaState";
import type { ArenaState } from "../lib/arenaState";

import { useArenaMeta } from "../utils/useArenaMeta";
import {
  useArenaPresence,
  usePresenceDisplayNameResolver,
  primePresenceDisplayNameCache,
} from "../utils/useArenaPresence";
import { usePresenceRoster } from "../utils/useArenaPresence";
import {
  HEARTBEAT_ACTIVE_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_GRACE_BUFFER_MS,
} from "../utils/presenceThresholds";
import { loadTabPresenceId } from "../utils/sessionId";

import { useAuth } from "../context/AuthContext";
import TouchControls from "../game/input/TouchControls";
import { useArenaRuntime } from "../utils/useArenaRuntime";

// Optional: keep a gated warn helper (don’t also import debugWarn)
const debugWarn = (...args: unknown[]) => {
  if (!ARENA_NET_DEBUG) return;
  console.warn(...args);
};

export default function ArenaPage() {
  const { arenaId = "" } = useParams();
  const nav = useNavigate();
  const [stateReady, setStateReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<ArenaState | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [touchControlsEnabled, setTouchControlsEnabled] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);
  const authUidRef = useRef<string | null>(null);
  const presenceIdRef = useRef<string | null>(null);
  const rosterLogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderIdRef = useRef(0);
  const joinRunIdCounterRef = useRef(0);
  const completedJoinRunIdsRef = useRef<Set<number>>(new Set());
  const currentJoinKeyRef = useRef<string | null>(null);

  const {
    players: presence,
    loading: presenceLoading,
    error: presenceError,
  } = useArenaPresence(arenaId);

  const { names: rosterNames, count: rosterCount } = usePresenceRoster(arenaId);

  // Optional: formatted chip string for UI
  const formattedRosterNames = useMemo(() => {
    const head = rosterNames.slice(0, 3).join(", ");
    return rosterCount > 3 ? `${head} (+${rosterCount - 3})` : head;
  }, [rosterNames, rosterCount]);

  const { user, player, authReady } = useAuth();

  const { arenaName, loading: arenaMetaLoading } = useArenaMeta(arenaId);
  const resolvePresenceDisplayName = usePresenceDisplayNameResolver();

  // keep a one-time logger ref if later code logs the title once
  const titleLoggedRef = useRef(false);

  // Human title for header; never show the doc id
  const arenaTitle = arenaName ?? "Arena";

  useEffect(() => {
    const uid = auth.currentUser?.uid ?? user?.uid ?? null;
    if (!uid) return;
    authUidRef.current = uid;
    if (!presenceIdRef.current) {
      try {
        presenceIdRef.current = loadTabPresenceId(uid);
      } catch (error) {
        console.warn("[PRESENCE] failed to load presenceId", error);
        presenceIdRef.current = `${uid}-fallback`;
      }
    }
    const authDisplayName = auth.currentUser?.displayName ?? null;
    primePresenceDisplayNameCache(uid, authDisplayName);
    if (player?.id) {
      primePresenceDisplayNameCache(player.id, player.displayName ?? null);
    }
  }, [authReady, player?.displayName, player?.id, user?.uid]);

  useEffect(() => {
    debugLog("[UI] seats/host hidden (seatless mode)");
  }, []);

  useEffect(() => {
    titleLoggedRef.current = false;
  }, [arenaId]);

  useEffect(() => {
    if (!arenaId) return;
    if (arenaMetaLoading) return;
    if (titleLoggedRef.current) return;
    console.log(`[ARENA] title="${arenaTitle}" id=${arenaId}`);
    titleLoggedRef.current = true;
  }, [arenaId, arenaMetaLoading, arenaTitle]);

  useEffect(() => {
    if (!arenaId) return;
    if (presenceLoading) return;
  }, [arenaId, presenceLoading]);

  useEffect(() => {
    if (!arenaId) return;
    if (presenceLoading) return;

    if (rosterLogTimerRef.current) {
      clearTimeout(rosterLogTimerRef.current);
      rosterLogTimerRef.current = null;
    }

    const ids = presence.map((entry) => entry.presenceId ?? entry.playerId ?? "");
    rosterLogTimerRef.current = setTimeout(() => {
      const joinedIds = ids.join(", ");
      console.log(`[PRESENCE] roster stable=${ids.length} ids=[${joinedIds}]`);
      debugLog(
        `[ARENA] roster arena=${arenaId} n=${rosterCount} names=${formattedRosterNames}`,
        { rosterNames },
      );
    }, 2_000);

    return () => {
      if (rosterLogTimerRef.current) {
        clearTimeout(rosterLogTimerRef.current);
        rosterLogTimerRef.current = null;
      }
    };
  }, [arenaId, formattedRosterNames, presence, presenceLoading, rosterCount, rosterNames]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const detectTouch = () => {
      const nav = window.navigator as Navigator & {
        maxTouchPoints?: number;
        msMaxTouchPoints?: number;
      };
      const maxPoints = typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0;
      const navAny = nav as { msMaxTouchPoints?: number };
      const msPoints = typeof navAny.msMaxTouchPoints === "number" ? navAny.msMaxTouchPoints : 0;
      const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
      const hasOntouch = "ontouchstart" in window;
      const next = maxPoints > 0 || msPoints > 0 || coarse || hasOntouch;
      setTouchControlsEnabled((prev) => (prev === next ? prev : next));
    };

    detectTouch();

    const handleChange = () => detectTouch();
    const pointerQuery = window.matchMedia?.("(pointer: coarse)");
    if (pointerQuery?.addEventListener) {
      pointerQuery.addEventListener("change", handleChange);
    } else if (pointerQuery?.addListener) {
      pointerQuery.addListener(handleChange);
    }
    window.addEventListener("orientationchange", handleChange);
    window.addEventListener("touchstart", handleChange, { passive: true });

    return () => {
      if (pointerQuery?.removeEventListener) {
        pointerQuery.removeEventListener("change", handleChange);
      } else if (pointerQuery?.removeListener) {
        pointerQuery.removeListener(handleChange);
      }
      window.removeEventListener("orientationchange", handleChange);
      window.removeEventListener("touchstart", handleChange);
    };
  }, []);

  // Auto-init + subscribe
  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      debugLog("[ARENA] arena state init skipped: auth not ready", { arenaId });
      return;
    }
    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        debugLog("[ARENA] arena state init starting", { arenaId });
        await ensureArenaState(db, arenaId); // Create doc if missing
        if (cancelled) return;
        unsub = await watchArenaState(
          db,
          arenaId,
          (s) => {
            setState(s);
            setStateReady(!!s);
          },
          (e) => {
            console.error("[ARENA] arena watch error", e);
            setErr("Live state failed to load.");
          }
        );
        debugLog("[ARENA] arena state subscription active", { arenaId });
      } catch (e) {
        if (cancelled) return;
        console.error("[ARENA] arena init error", e);
        setErr("Failed to initialize arena state.");
      }
    })();

    return () => {
      cancelled = true;
      setStateReady(false);
      if (unsub) {
        unsub();
      }
    };
  }, [arenaId, authReady]);

  // Touch player presence in state (hp + updatedAt)
  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      debugLog("[ARENA] touchPlayer skipped: auth not ready", { arenaId });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        debugLog("[ARENA] touchPlayer start", { arenaId, uid: user?.uid });
        await touchPlayer(db, arenaId);
        if (!cancelled) {
          debugLog("[ARENA] touchPlayer complete", { arenaId, uid: user?.uid });
        }
      } catch (e) {
        if (cancelled) return;
        debugWarn("[ARENA] touchPlayer failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arenaId, authReady, user?.uid]);

  renderIdRef.current += 1;
  const renderId = renderIdRef.current;
  const authUidSnapshot = authUidRef.current;
  const presenceIdSnapshot = presenceIdRef.current;
  const joinKeySnapshot =
    arenaId && authUidSnapshot && presenceIdSnapshot
      ? `${arenaId}::${authUidSnapshot}::${presenceIdSnapshot}`
      : null;
  currentJoinKeyRef.current = joinKeySnapshot;

  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      debugLog("[PRESENCE] join skipped: auth not ready", { arenaId });
      return;
    }
    const authUid = authUidSnapshot;
    if (!authUid) {
      debugLog("[PRESENCE] join skipped: missing auth uid", { arenaId });
      return;
    }
    const presenceId = presenceIdSnapshot;
    if (!presenceId) {
      debugLog("[PRESENCE] join skipped: missing presenceId", { arenaId, authUid });
      return;
    }

    const effectJoinKey = joinKeySnapshot;
    const effectRenderId = renderId;
    const joinRunId = ++joinRunIdCounterRef.current;

    const codename = player?.codename ?? authUid.slice(0, 6);
    const profileId = player?.id;
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    debugLog("[PRESENCE] join effect starting", { arenaId, authUid, presenceId, codename });

    const computeDisplayName = async (): Promise<string> => {
      const suffix = authUid.slice(-2).toUpperCase();
      const fallback = suffix ? `Player ${suffix}` : "Player";
      const direct = typeof player?.displayName === "string" ? player.displayName.trim() : "";
      if (direct.length > 0) {
        if (profileId) {
          primePresenceDisplayNameCache(profileId, direct);
        }
        return direct;
      }

      if (profileId) {
        const resolved = await resolvePresenceDisplayName(profileId);
        const trimmed = resolved.trim();
        if (trimmed.length > 0) {
          primePresenceDisplayNameCache(profileId, trimmed);
          return trimmed;
        }
      }

      return fallback;
    };

    const pushJoin = async () => {
      const nextDisplayName = await computeDisplayName();
      await joinArena(arenaId, { authUid, presenceId }, codename, profileId, nextDisplayName);
      const safeDisplayName = nextDisplayName.replace(/"/g, '\\"');
      console.log(
        `[PRESENCE] joined authUid=${authUid} presenceId=${presenceId} displayName="${safeDisplayName}"`,
      );
    };

    const pushHeartbeat = async () => {
      const nextDisplayName = await computeDisplayName();
      await heartbeatArenaPresence(
        arenaId,
        { authUid, presenceId },
        codename,
        profileId,
        nextDisplayName,
      );
      const safeDisplayName = nextDisplayName.replace(/"/g, '\\"');
      console.log(
        `[HEARTBEAT] lastSeen updated authUid=${authUid} presenceId=${presenceId} displayName="${safeDisplayName}"`,
      );
    };

    (async () => {
      try {
        debugLog("[PRESENCE] ensureAnonAuth", { arenaId, authUid, presenceId });
        await ensureAnonAuth();
        if (cancelled) return;

        debugLog("[PRESENCE] joinArena", { arenaId, authUid, presenceId, codename, profileId });
        await pushJoin();
        if (cancelled) return;

        debugLog("[PRESENCE] join complete", { arenaId, authUid, presenceId });
        completedJoinRunIdsRef.current.add(joinRunId);

        debugLog("[PRESENCE] heartbeat schedule", {
          arenaId,
          authUid,
          presenceId,
          intervalMs: HEARTBEAT_INTERVAL_MS,
          activeWindowMs: HEARTBEAT_ACTIVE_WINDOW_MS,
          graceMs: PRESENCE_GRACE_BUFFER_MS,
        });

        heartbeat = setInterval(() => {
          debugLog("[PRESENCE] heartbeat", { arenaId, authUid, presenceId });
          pushHeartbeat().catch((e) => {
            debugWarn("[PRESENCE] heartbeat failed", e);
          });
        }, HEARTBEAT_INTERVAL_MS);
        // Heartbeats fire every ~10s (HEARTBEAT_INTERVAL_MS). Presence consumers keep entries active
        // while heartbeats land within ~20s (HEARTBEAT_ACTIVE_WINDOW_MS) of the last seen timestamp
        // and also honor Firestore's expireAt plus an extra 60s (PRESENCE_GRACE_BUFFER_MS). QA:
        // combine those numbers when reasoning about failover/quorum timing.
      } catch (e) {
        if (cancelled) return;
        console.error("[PRESENCE] join failed", e);
      }
    })();

    return () => {
      cancelled = true;
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      const joined = completedJoinRunIdsRef.current.has(joinRunId);
      const latestRenderId = renderIdRef.current;
      const upcomingJoinKey = currentJoinKeyRef.current;
      const hasNewerRender = latestRenderId > effectRenderId;
      const identityChanged = effectJoinKey !== upcomingJoinKey;

      if (joined && (!hasNewerRender || identityChanged)) {
        debugLog("[PRESENCE] leaveArena", { arenaId, authUid, presenceId });
        leaveArena(arenaId, presenceId).catch((e) => {
          debugWarn("[PRESENCE] leave failed", e);
        });
      } else if (ARENA_NET_DEBUG && joined) {
        debugLog("[PRESENCE] leave skipped", {
          arenaId,
          authUid,
          presenceId,
          hasNewerRender,
          identityChanged,
        });
      }

      completedJoinRunIdsRef.current.delete(joinRunId);
    };
  }, [
    arenaId,
    authReady,
    player?.codename,
    player?.displayName,
    player?.id,
    resolvePresenceDisplayName,
    user?.uid,
  ]);

  useEffect(() => {
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    const unsubscribe = watchLeaderboard(
      (entries) => {
        setLeaderboard(entries);
        setLeaderboardLoading(false);
      },
      () => {
        setLeaderboardError("Failed to load leaderboard.");
        setLeaderboardLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  const meUid = authUidRef.current;

  const writerUid = state?.writerUid ?? null;
  const lastWriterUid = state?.lastWriter ?? null;

  // Resolve host by authUid from state (prefer lastWriter for stability)
  const hostAuthUid = lastWriterUid ?? writerUid ?? null;

  const hostEntry = useMemo(() => {
    if (!hostAuthUid) return null;
    return presence.find((entry) => entry.authUid === hostAuthUid) ?? null;
  }, [hostAuthUid, presence]);

  const hostLabel = hostEntry
    ? `${hostEntry.codename ?? hostEntry.playerId.slice(0, 6)}${
        hostEntry.authUid && hostEntry.authUid === meUid ? " (you)" : ""
      }`
    : "—";

  const { gameBooted } = useArenaRuntime({
    arenaId,
    authReady,
    stateReady,
    meUid,
    codename: player?.codename ?? null,
    presence,
    writerUid,
    canvasRef,
    onBootError: (message) => setRuntimeMessage((prev) => prev ?? message),
  });

  const debugFooter = useMemo(() => {
    const tick = state?.tick ?? 0;
    const playersCount = rosterCount;
    return `tick=${tick} · agents=${playersCount} · host=${hostLabel} · ready=${stateReady}`;
  }, [hostLabel, rosterCount, state?.tick, stateReady]);

  return (
    <div className="grid" style={{ gap: 24 }}>
      <section className="card">
        <div className="card-header">
          <div className="meta-grid">
            <span className="muted mono">Arena</span>
            <h2 style={{ margin: 0 }}>{arenaTitle}</h2>
          </div>
          <div className="button-row">
            <button type="button" className="button ghost" onClick={() => nav("/")}>
              ← Lobby
            </button>
          </div>
        </div>
        <div className="grid" style={{ gap: 16 }}>
          <div>
            <span className="muted mono">Tick</span>
            <div style={{ fontSize: "var(--fs-xl)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              {state?.tick ?? "—"}
            </div>
          </div>
          <div>
            <span className="muted mono">Agents online</span>
            <div style={{ marginTop: 8 }}>
              {presenceLoading ? (
                <span className="skel" style={{ width: 140, height: 16 }} />
              ) : rosterCount > 0 ? (
                rosterNames.length ? (
                  <div className="chips">
                    {rosterNames.map((name) => (
                      <span className="chip" key={name}>
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="muted">Agents connected.</span>
                )
              ) : (
                <span className="muted">No players connected.</span>
              )}
            </div>
          </div>
        </div>
        {!stateReady && (
          <div className="error" style={{ marginTop: 16 }}>
            Initializing arena… waiting for /arenas/{arenaId}/state
          </div>
        )}
        {err ? (
          <div className="error" style={{ marginTop: 16 }}>
            {err}
          </div>
        ) : null}
        {presenceError ? (
          <div className="error" style={{ marginTop: 16 }}>
            Failed to load presence data.
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="muted mono" style={{ marginBottom: 8 }}>
          Leaderboard
        </div>
        {leaderboardLoading ? (
          <div className="grid" style={{ gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ height: 18, width: "100%" }} />
            ))}
          </div>
        ) : leaderboard.length ? (
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 8,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-sm)",
            }}
          >
            {leaderboard.slice(0, 5).map((entry, index) => (
              <li
                key={entry.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
              >
                <span>
                  <span className="muted">{index + 1}.</span>{" "}
                  {entry.playerCodename ?? entry.playerId.slice(0, 6)}
                </span>
                <span className="muted">
                  S{entry.streak ?? 0} · W{entry.wins ?? 0}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <span className="muted">No wins recorded yet.</span>
        )}
        {leaderboardError ? (
          <div className="error" style={{ marginTop: 12 }}>{leaderboardError}</div>
        ) : null}
      </section>

      <section className="card card-canvas">
        {runtimeMessage ? (
          <div className="error" style={{ marginBottom: 12 }}>{runtimeMessage}</div>
        ) : null}
        <div
          ref={canvasRef}
          className="canvas-frame"
          style={{
            minHeight: 420,
            background:
              "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.04) 0 35%, transparent 60%), var(--bg-soft)",
            display: "grid",
            placeItems: "center",
          }}
        >
          {!gameBooted && (
            <div
              className="muted"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)", textAlign: "center" }}
            >
              Arena scene boots once auth and /state/current are ready.
            </div>
          )}
          {touchControlsEnabled && gameBooted ? <TouchControls /> : null}
        </div>
        <div className="card-footer">[NET] {debugFooter}</div>
      </section>
    </div>
  );
}
