import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import type { Arena } from "../types/models";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { joinArena, leaveArena } from "../db";
import { joinOrCreate1v1, removePlayerFromMatch, subscribeMatch } from "../netcode/refereeStore";
import type { MatchDoc, Snapshot } from "../types/netcode";
import { startClientLoop } from "../netcode/clientLoop";
import { startRefereeLoop } from "../netcode/refereeLoop";
import { useKeyBinder } from "../game/input/KeyBinder";
import { sampleKeyboardIntent } from "../utils/input";

const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 540;
const PLAYER_WIDTH = 28;
const PLAYER_HEIGHT = 48;
const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2;
const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2;

const ArenaPage: React.FC = () => {
  const { arenaId } = useParams<{ arenaId: string }>();
  const navigate = useNavigate();
  const { player } = useAuth();

  const [arena, setArena] = useState<Arena | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [role, setRole] = useState<"referee" | "client" | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<Snapshot | null>(null);
  const [tick, setTick] = useState(0);

  const keysRef = useKeyBinder();
  const matchIdRef = useRef<string | null>(null);

  const clientLoopCleanup = useRef<() => void>();
  const refereeLoopCleanup = useRef<() => void>();

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
            createdAt: data.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
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
    matchIdRef.current = matchId;
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    setLatestSnapshot(null);
    setTick(0);
    const unsubscribe = subscribeMatch(matchId, (doc) => {
      setMatch(doc);
      setTick(doc.tick);
      if (player) {
        const slot = doc.players.findIndex((p) => p.playerId === player.id);
        if (slot === 0) {
          setRole("referee");
        } else if (slot === 1) {
          setRole("client");
        } else {
          setRole(null);
        }
      }
    });
    return unsubscribe;
  }, [matchId, player]);

  const slot = useMemo(() => {
    if (!match || !player) return null;
    const idx = match.players.findIndex((p) => p.playerId === player.id);
    if (idx === -1) return null;
    return (idx + 1) as 1 | 2;
  }, [match, player]);

  const getLocalIntent = useCallback(() => sampleKeyboardIntent(keysRef), [keysRef]);

  useEffect(() => {
    if (!matchId || !slot || !role) {
      return;
    }

    clientLoopCleanup.current?.();
    refereeLoopCleanup.current?.();

    clientLoopCleanup.current = startClientLoop(matchId, slot, getLocalIntent, (snap) => {
      setLatestSnapshot(snap);
      setTick(snap.t);
    });

    if (role === "referee") {
      refereeLoopCleanup.current = startRefereeLoop(matchId, {
        onTick: (t) => setTick(t),
      });
    } else {
      refereeLoopCleanup.current = undefined;
    }

    return () => {
      clientLoopCleanup.current?.();
      refereeLoopCleanup.current?.();
      clientLoopCleanup.current = undefined;
      refereeLoopCleanup.current = undefined;
    };
  }, [matchId, slot, role, getLocalIntent]);

  useEffect(() => {
    return () => {
      clientLoopCleanup.current?.();
      refereeLoopCleanup.current?.();
    };
  }, []);

  useEffect(() => {
    if (role) {
      return;
    }
    clientLoopCleanup.current?.();
    refereeLoopCleanup.current?.();
    clientLoopCleanup.current = undefined;
    refereeLoopCleanup.current = undefined;
  }, [role]);

  const statusRibbon = (
    <div
      style={{
        background: "#111827",
        color: "#e5e7eb",
        padding: "8px 12px",
        borderRadius: "8px",
        marginBottom: "16px",
        fontSize: "14px",
      }}
    >
      Match: {matchId ?? "…"} · Role: {role ?? "–"} · Tick: {tick}
    </div>
  );

  const waitingNotice = match && match.status !== "active" ? (
    <p style={{ color: "#fbbf24", marginBottom: "12px" }}>Waiting for another player…</p>
  ) : null;

  const renderSnapshot = () => {
    if (!latestSnapshot) {
      return <div style={{ color: "#9ca3af" }}>Waiting for referee…</div>;
    }
    const p1Name = match?.players[0]?.codename ?? "P1";
    const p2Name = match?.players[1]?.codename ?? "P2";
    const p1Top = latestSnapshot.p1.y - PLAYER_HALF_HEIGHT;
    const p2Top = latestSnapshot.p2.y - PLAYER_HALF_HEIGHT;
    const p1Left = latestSnapshot.p1.x - PLAYER_HALF_WIDTH;
    const p2Left = latestSnapshot.p2.x - PLAYER_HALF_WIDTH;
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: `${p1Left}px`,
            top: `${p1Top}px`,
            width: `${PLAYER_WIDTH}px`,
            height: `${PLAYER_HEIGHT}px`,
            background: slot === 1 ? "#38bdf8" : "#3b82f6",
            borderRadius: "4px",
            transition: "transform 0.05s linear",
          }}
          title={`${p1Name} HP: ${latestSnapshot.p1.hp}`}
        />
        <div
          style={{
            position: "absolute",
            left: `${p2Left}px`,
            top: `${p2Top}px`,
            width: `${PLAYER_WIDTH}px`,
            height: `${PLAYER_HEIGHT}px`,
            background: slot === 2 ? "#38bdf8" : "#f97316",
            borderRadius: "4px",
            transition: "transform 0.05s linear",
          }}
          title={`${p2Name} HP: ${latestSnapshot.p2.hp}`}
        />
        <div
          style={{
            position: "absolute",
            left: "16px",
            top: "16px",
            color: "#e5e7eb",
            fontSize: "14px",
            textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          }}
        >
          <div>{p1Name}: {latestSnapshot.p1.hp} HP</div>
          <div>{p2Name}: {latestSnapshot.p2.hp} HP</div>
          {latestSnapshot.events?.map((event, idx) => (
            <div key={idx} style={{ color: "#f87171" }}>{event}</div>
          ))}
        </div>
      </>
    );
  };

  const handleExit = () => {
    navigate("/");
  };

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
        {statusRibbon}
        {waitingNotice}
        {!player ? (
          <div style={{ color: "#f87171", marginBottom: "12px" }}>
            Login to control a fighter.
          </div>
        ) : null}
        {error ? (
          <div style={{ color: "#f87171" }}>{error}</div>
        ) : null}
        <div
          style={{
            position: "relative",
            width: `${ARENA_WIDTH}px`,
            height: `${ARENA_HEIGHT}px`,
            background: "#111827",
            borderRadius: "12px",
            border: "1px solid #1f2937",
            overflow: "hidden",
            marginTop: "16px",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              width: "100%",
              height: "40px",
              background: "#1f2937",
            }}
          />
          {renderSnapshot()}
        </div>
      </div>
    </main>
  );
};

export default ArenaPage;
