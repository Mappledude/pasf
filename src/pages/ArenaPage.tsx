import { useArenaMeta } from "../utils/useArenaMeta";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import {
  db,
  ensureAnonAuth,
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
import {
  useArenaPresence,
  usePresenceDisplayNameResolver,
  primePresenceDisplayNameCache,
} from "../utils/useArenaPresence";
// seatless: removed useArenaSeats import

import { useAuth } from "../context/AuthContext";
import TouchControls from "../game/input/TouchControls";
import { useArenaRuntime } from "../utils/useArenaRuntime";
import { useArenaMeta } from "../utils/useArenaMeta";

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


  const { players: presence, loading: presenceLoading, error: presenceError } = useArenaPresence(arenaId);
const { user, player, authReady } = useAuth();

const { arenaName, loading: arenaMetaLoading } = useArenaMeta(arenaId);
const resolvePresenceDisplayName = usePresenceDisplayNameResolver();

// keep a one-time logger ref if later code logs the title once
const titleLoggedRef = useRef(false);

// Human title for header; never show the doc id
const arenaTitle = arenaName ?? "Arena";


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

  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      debugLog("[PRESENCE] join skipped: auth not ready", { arenaId });
      return;
    }
    if (!user?.uid) {
      debugLog("[PRESENCE] join skipped: missing uid", { arenaId });
      return;
    }

    const uid = user.uid;
    const codename = player?.codename ?? uid.slice(0, 6);
    const profileId = player?.id;
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    debugLog("[PRESENCE] join effect starting", { arenaId, uid, codename });

    const computeDisplayName = async (): Promise<string | null> => {
      if (profileId) {
        const resolved = await resolvePresenceDisplayName(profileId);
        const trimmed = resolved.trim();
        const normalized = trimmed.length > 0 ? trimmed : null;
        if (normalized) {
          primePresenceDisplayNameCache(profileId, normalized);
        }
        return normalized;
      }
      const fallback = typeof player?.displayName === "string" ? player.displayName.trim() : "";
      return fallback.length > 0 ? fallback : null;
    };

    const pushPresence = async () => {
      const nextDisplayName = await computeDisplayName();
      await joinArena(arenaId, uid, codename, profileId, nextDisplayName);
    };

    (async () => {
      try {
        debugLog("[PRESENCE] ensureAnonAuth", { arenaId, uid });
        await ensureAnonAuth();
        if (cancelled) return;

        debugLog("[PRESENCE] joinArena", { arenaId, uid, codename, profileId });
        await pushPresence();
        if (cancelled) return;

        debugLog("[PRESENCE] join complete", { arenaId, uid });

        heartbeat = setInterval(() => {
          debugLog("[PRESENCE] heartbeat", { arenaId, uid });
          pushPresence().catch((e) => {
            debugWarn("[PRESENCE] heartbeat failed", e);
          });
        }, 60000);
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
      debugLog("[PRESENCE] leaveArena", { arenaId, uid });
      leaveArena(arenaId, uid).catch((e) => {
        debugWarn("[PRESENCE] leave failed", e);
      });
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
    const unsubscribe = watchLeaderboard(
      (entries) => {
        setLeaderboard(entries);
        setLeaderboardLoading(false);
        setLeaderboardError(null);
      },
      () => {
        setLeaderboardError("Failed to load leaderboard.");
        setLeaderboardLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  const agents = useMemo(() => Object.keys(state?.players ?? {}), [state]);

  const chipNames = useMemo(() => {
    if (presence.length) {
      return presence.map((entry) => {
        const displayName = typeof entry.displayName === "string" ? entry.displayName.trim() : "";
        if (displayName.length > 0) {
          return displayName;
        }
        const codename = typeof entry.codename === "string" ? entry.codename.trim() : "";
        if (codename.length > 0) {
          return codename;
        }
        return "Player";
      });
    }
    return agents.map(() => "Player");
  }, [agents, presence]);

  const meUid = user?.uid ?? null;

  const hostEntry = useMemo(() => {
    if (!presence.length) return null;
    const parseTs = (value?: string) => {
      if (!value) return Number.POSITIVE_INFINITY;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };
    return [...presence].sort((a, b) => {
      const aTs = parseTs(a.joinedAt);
      const bTs = parseTs(b.joinedAt);
      if (aTs !== bTs) return aTs - bTs;
      const aKey = a.playerId ?? a.authUid ?? "";
      const bKey = b.playerId ?? b.authUid ?? "";
      return aKey.localeCompare(bKey);
    })[0];
  }, [presence]);

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
    canvasRef,
    onBootError: (message) => setRuntimeMessage((prev) => prev ?? message),
  });

  const debugFooter = useMemo(() => {
    const tick = state?.tick ?? 0;
    const playersCount = chipNames.length;
    return `tick=${tick} · agents=${playersCount} · host=${hostLabel} · ready=${stateReady}`;
  }, [chipNames.length, hostLabel, state?.tick, stateReady]);

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
              ) : chipNames.length ? (
                <div className="chips">
                  {chipNames.map((name) => (
                    <span className="chip" key={name}>
                      {name}
                    </span>
                  ))}
                </div>
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
            background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.04) 0 35%, transparent 60%), var(--bg-soft)",
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
