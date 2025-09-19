import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import type { Arena } from "../types/models";
import type { MatchStatus, Snapshot } from "../types/netcode";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { joinArena, leaveArena } from "../db";
import { createKeyBinder } from "../game/input/KeyBinder";
import { toIntent } from "../utils/input";
import { joinOrCreate1v1, removePlayerFromMatch, subscribeMatch } from "../netcode/refereeStore";
import { startClientLoop } from "../netcode/clientLoop";
import { startRefereeLoop } from "../netcode/refereeLoop";

const FALLBACK_KEYS = { left: false, right: false, up: false, jump: false, attack: false, seq: 0 };

const ArenaPage: React.FC = () => {
  const { arenaId } = useParams<{ arenaId: string }>();
  const navigate = useNavigate();
  const { player } = useAuth();

  const [arena, setArena] = useState<Arena | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [role, setRole] = useState<"referee" | "client" | null>(null);
  const [slot, setSlot] = useState<1 | 2 | null>(null);
  const [status, setStatus] = useState<MatchStatus>("waiting");
  const [tick, setTick] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const binderRef = useRef<ReturnType<typeof createKeyBinder> | null>(null);
  const clientLoopCleanup = useRef<() => void>();
  const refereeLoopCleanup = useRef<() => void>();
  const matchIdRef = useRef<string | null>(null);

  useEffect(() => {
    const binder = createKeyBinder();
    binderRef.current = binder;
    return () => {
      binder.dispose();
      binderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!arenaId) {
      setError("Arena not found");
      return;
    }
    let cancelled = false;

    const loadArena = async () => {
      try {
        const arenaDoc = await getDoc(doc(db, "arenas", arenaId));
        if (!arenaDoc.exists()) {
          if (!cancelled) setError("Arena not found");
          return;
        }
        const data = arenaDoc.data();
        if (!cancelled) {
          setArena({
            id: arenaDoc.id,
            name: data.name,
            description: data.description ?? "",
            capacity: data.capacity ?? undefined,
            isActive: Boolean(data.isActive),
            createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Failed to load arena");
      }
    };

    loadArena().catch((err) => console.error(err));

    return () => {
      cancelled = true;
    };
  }, [arenaId]);

  useEffect(() => {
    matchIdRef.current = matchId;
  }, [matchId]);

  useEffect(() => {
    setSnapshot(null);
    setTick(0);
  }, [matchId]);

  useEffect(() => {
    if (!arenaId || !player) {
      return;
    }
    let mounted = true;

    joinArena(arenaId, player.id, player.codename).catch((err) => {
      console.warn("[ArenaPage] failed to join presence", err);
    });

    joinOrCreate1v1(arenaId, { playerId: player.id, codename: player.codename })
      .then((res) => {
        if (!mounted) return;
        setMatchId(res.matchId);
        setRole(res.role);
        setSlot(res.slot);
        setStatus(res.role === "referee" ? "waiting" : "active");
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to join match");
      });

    return () => {
      mounted = false;
      clientLoopCleanup.current?.();
      refereeLoopCleanup.current?.();
      clientLoopCleanup.current = undefined;
      refereeLoopCleanup.current = undefined;
      if (arenaId && player) {
        leaveArena(arenaId, player.id).catch((err) => {
          console.warn("[ArenaPage] failed to leave presence", err);
        });
        if (matchIdRef.current) {
          removePlayerFromMatch(matchIdRef.current, player.id).catch((err) => {
            console.warn("[ArenaPage] failed to update match on exit", err);
          });
        }
      }
    };
  }, [arenaId, player]);

  useEffect(() => {
    if (!matchId) return;
    const unsubscribe = subscribeMatch(matchId, (doc) => {
      setStatus(doc.status);
      if (player) {
        const idx = doc.players.findIndex((p) => p.playerId === player.id);
        if (idx === 0) {
          setRole("referee");
          setSlot(1);
        } else if (idx === 1) {
          setRole("client");
          setSlot(2);
        }
      }
    });
    return unsubscribe;
  }, [matchId, player]);

  useEffect(() => {
    if (!matchId || !slot || !role) {
      return;
    }

    clientLoopCleanup.current?.();
    refereeLoopCleanup.current?.();

    const getLocalIntent = () => {
      const binder = binderRef.current;
      return toIntent(binder ? binder.state : FALLBACK_KEYS);
    };

    clientLoopCleanup.current = startClientLoop(matchId, slot, getLocalIntent, (snap) => {
      setSnapshot(snap);
      setTick(snap.t);
    });

    if (role === "referee") {
      refereeLoopCleanup.current = startRefereeLoop(matchId);
    } else {
      refereeLoopCleanup.current = undefined;
    }

    return () => {
      clientLoopCleanup.current?.();
      refereeLoopCleanup.current?.();
      clientLoopCleanup.current = undefined;
      refereeLoopCleanup.current = undefined;
    };
  }, [matchId, slot, role]);

  useEffect(() => {
    return () => {
      clientLoopCleanup.current?.();
      refereeLoopCleanup.current?.();
      binderRef.current?.dispose();
    };
  }, []);

  const handleExit = () => {
    navigate("/");
  };

  const hud = (
    <div style={{ padding: "8px", fontSize: 12, color: "#9CA3AF" }}>
      Match: {matchId ?? "…"} · Role: {role ?? "–"} · Tick: {tick} · P1 HP: {snapshot?.p1.hp ?? 100} · P2 HP: {snapshot?.p2.hp ?? 100}
      {status !== "active" && <span> · Waiting for another player…</span>}
    </div>
  );

  const positions = snapshot ? (
    <div style={{ color: "#E5E7EB", background: "#111827", padding: "12px", borderRadius: "8px" }}>
      <div>Tick: {snapshot.t}</div>
      <div>P1 – x: {snapshot.p1.x.toFixed(1)}, y: {snapshot.p1.y.toFixed(1)}, vx: {snapshot.p1.vx.toFixed(1)}, vy: {snapshot.p1.vy.toFixed(1)}, HP: {snapshot.p1.hp}</div>
      <div>P2 – x: {snapshot.p2.x.toFixed(1)}, y: {snapshot.p2.y.toFixed(1)}, vx: {snapshot.p2.vx.toFixed(1)}, vy: {snapshot.p2.vy.toFixed(1)}, HP: {snapshot.p2.hp}</div>
      {snapshot.events?.length ? (
        <div style={{ marginTop: "8px", color: "#F87171" }}>Events: {snapshot.events.join(", ")}</div>
      ) : null}
    </div>
  ) : (
    <div style={{ color: "#9CA3AF" }}>Waiting for referee…</div>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#0f1115", color: "#e5e7eb" }}>
      <div style={{ padding: "16px" }}>
        <Link to="/" style={{ color: "#7dd3fc", textDecoration: "none" }}>
          ← Lobby
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
          <h1 style={{ margin: 0 }}>{arena?.name ?? "Arena"}</h1>
          <button
            type="button"
            onClick={handleExit}
            style={{
              background: "#ef4444",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Exit Arena
          </button>
        </div>
        {arena?.description ? <p style={{ color: "#9ca3af" }}>{arena.description}</p> : null}
        {hud}
        {!player ? (
          <div style={{ color: "#f87171", marginBottom: "12px" }}>
            Login to control a fighter.
          </div>
        ) : null}
        {error ? (
          <div style={{ color: "#f87171" }}>{error}</div>
        ) : null}
        <div style={{ marginTop: "16px" }}>{positions}</div>
      </div>
    </main>
  );
};

export default ArenaPage;
