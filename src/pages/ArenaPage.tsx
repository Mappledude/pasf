import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  ensureArenaState,
  watchArenaState,
  touchPlayer,
  type ArenaState,
} from "../lib/arenaState";
import { useArenaPresence } from "../utils/useArenaPresence";

export default function ArenaPage() {
  const { arenaId = "" } = useParams();
  const nav = useNavigate();
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [stateReady, setStateReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<ArenaState | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const { players: presence, loading: presenceLoading, error: presenceError } = useArenaPresence(arenaId);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return unsub;
  }, []);

  // Auto-init + subscribe
  useEffect(() => {
    if (!arenaId) return;
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        await ensureArenaState(db, arenaId);     // Create doc if missing
        unsub = watchArenaState(
          db,
          arenaId,
          (s) => {
            setState(s);
            setStateReady(!!s);
          },
          (e) => {
            console.error("[arena watch] error", e);
            setErr("Live state failed to load.");
          }
        );
      } catch (e) {
        console.error("[arena init] error", e);
        setErr("Failed to initialize arena state.");
      }
    })();

    return () => unsub?.();
  }, [arenaId]);

  // Touch player presence in state (hp + updatedAt)
  useEffect(() => {
    if (!arenaId || !uid) return;
    touchPlayer(db, arenaId, { uid } as any).catch((e) =>
      console.warn("[touchPlayer] failed", e)
    );
  }, [arenaId, uid]);

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
