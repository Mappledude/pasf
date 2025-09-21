import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, ensureAnonAuth, joinArena, leaveArena } from "../firebase";
import {
  ensureArenaState,
  watchArenaState,
  touchPlayer,
  type ArenaState,
} from "../lib/arenaState";
import { useArenaPresence } from "../utils/useArenaPresence";
import { useAuth } from "../context/AuthContext";

export default function ArenaPage() {
  const { arenaId = "" } = useParams();
  const nav = useNavigate();
  const [stateReady, setStateReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<ArenaState | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const { players: presence, loading: presenceLoading, error: presenceError } = useArenaPresence(arenaId);
  const { user, player, loading: authLoading, authReady } = useAuth();

  // Auto-init + subscribe
  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      console.info("[ARENA] arena state init skipped: auth not ready", { arenaId });
      return;
    }
    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        console.info("[ARENA] arena state init starting", { arenaId });
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
        console.info("[ARENA] arena state subscription active", { arenaId });
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
      console.info("[ARENA] touchPlayer skipped: auth not ready", { arenaId });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        console.info("[ARENA] touchPlayer start", { arenaId, uid: user?.uid });
        await touchPlayer(db, arenaId);
        if (!cancelled) {
          console.info("[ARENA] touchPlayer complete", { arenaId, uid: user?.uid });
        }
      } catch (e) {
        if (cancelled) return;
        console.warn("[ARENA] touchPlayer failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arenaId, authReady, user?.uid]);

  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      console.info("[PRESENCE] join skipped: auth not ready", { arenaId });
      return;
    }
    if (!user?.uid) {
      console.info("[PRESENCE] join skipped: missing uid", { arenaId });
      return;
    }

    const uid = user.uid;
    const codename = player?.codename ?? uid.slice(0, 6);
    const profileId = player?.id;
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    console.info("[PRESENCE] join effect starting", { arenaId, uid, codename });

    (async () => {
      try {
        console.info("[PRESENCE] ensureAnonAuth", { arenaId, uid });
        await ensureAnonAuth();
        if (cancelled) return;

        console.info("[PRESENCE] joinArena", { arenaId, uid, codename });
        await joinArena(arenaId, uid, codename, profileId);
        if (cancelled) return;

        console.info("[PRESENCE] join complete", { arenaId, uid });

        heartbeat = setInterval(() => {
          console.info("[PRESENCE] heartbeat", { arenaId, uid });
          joinArena(arenaId, uid, codename, profileId).catch((e) => {
            console.warn("[PRESENCE] heartbeat failed", e);
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
      console.info("[PRESENCE] leaveArena", { arenaId, uid });
      leaveArena(arenaId, uid).catch((e) => {
        console.warn("[PRESENCE] leave failed", e);
      });
    };
  }, [arenaId, authReady, player?.codename, player?.id, user?.uid]);

  const agents = useMemo(() => Object.keys(state?.players ?? {}), [state]);

  const chipNames = useMemo(() => {
    if (presence.length) {
      return presence.map((entry) => entry.codename || entry.playerId.slice(0, 6));
    }
    return agents;
  }, [agents, presence]);

  const debugFooter = useMemo(() => {
    const tick = state?.tick ?? 0;
    const playersCount = chipNames.length;
    return `tick=${tick} · agents=${playersCount} · ready=${stateReady}`;
  }, [chipNames.length, state?.tick, stateReady]);

  return (
    <div className="grid" style={{ gap: 24 }}>
      <section className="card">
        <div className="card-header">
          <div className="meta-grid">
            <span className="muted mono">Arena</span>
            <h2 style={{ margin: 0 }}>{arenaId || "Arena"}</h2>
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

      <section className="card card-canvas">
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
          <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)" }}>
            Phaser canvas bootstraps here.
          </div>
        </div>
        <div className="card-footer">[NET] {debugFooter}</div>
      </section>
    </div>
  );
}
