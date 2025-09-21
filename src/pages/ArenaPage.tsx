import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  ensureArenaState,
  watchArenaState,
  touchPlayer,
  type ArenaState,
} from "../lib/arenaState";

export default function ArenaPage() {
  const { arenaId = "" } = useParams();
  const nav = useNavigate();
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [stateReady, setStateReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<ArenaState | undefined>(undefined);

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

  return (
    <div style={{ minHeight: "100vh", background: "#0f1115", color: "#e6e6e6" }}>
      <div style={{ padding: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={() => nav("/")} style={{ color: "#7dd3fc" }}>← Exit Arena</button>
        <h2 style={{ margin: 0 }}>{arenaId || "Arena"}</h2>
      </div>

      <div style={{ padding: 12 }}>
        <div><strong>Agents Present</strong></div>
        <div style={{ opacity: 0.9, marginBottom: 8 }}>
          {agents.length ? agents.join(", ") : "None"}
        </div>

        {!stateReady && (
          <div style={{ padding: 12, background: "#111827", borderRadius: 8 }}>
            <div style={{ marginBottom: 6 }}>Initializing arena…</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Waiting for live state document at <code>/arenas/{arenaId}/state</code>.
            </div>
            {err && (
              <div style={{ marginTop: 8, color: "#fca5a5" }}>
                Error: {err}
              </div>
            )}
          </div>
        )}

        {stateReady && (
          <div style={{ padding: 12, background: "#0b1220", borderRadius: 8 }}>
            <div>Tick: {state?.tick ?? 0}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              HP map: {JSON.stringify(state?.players ?? {})}
            </div>
            <div style={{ marginTop: 8, opacity: 0.8 }}>
              Gameplay wiring next: sync inputs, apply damage, and tick at ~10Hz.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
