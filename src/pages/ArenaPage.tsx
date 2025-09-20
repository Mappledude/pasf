import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ensureAnonAuth,
  getArena,
  joinArena,
  leaveArena,
  watchArenaPresence,
} from "../firebase";
import { useAuth } from "../context/AuthContext";
import type { Arena, ArenaPresenceEntry } from "../types/models";

const ArenaPage: React.FC = () => {
  const { arenaId } = useParams<{ arenaId: string }>();
  const navigate = useNavigate();
  const { player, loading } = useAuth();

  const [arena, setArena] = useState<Arena | null>(null);
  const [playersInArena, setPlayersInArena] = useState<ArenaPresenceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAnonAuth().catch((err) => console.warn("ensureAnonAuth skipped", err));
  }, []);

  useEffect(() => {
    if (!loading && !player) {
      navigate("/");
    }
  }, [loading, player, navigate]);

  useEffect(() => {
    if (!arenaId) {
      setError("Arena not found");
      return;
    }
    let cancelled = false;

    const loadArena = async () => {
      try {
        const data = await getArena(arenaId);
        if (!data) {
          if (!cancelled) setError("Arena not found");
          return;
        }
        if (!cancelled) {
          setArena(data);
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

    let unsubscribe: (() => void) | undefined;
    let active = true;

    const enterArena = async () => {
      try {
        await joinArena(arenaId, player.id, player.codename);
        if (!active) return;
        unsubscribe = watchArenaPresence(arenaId, (entries) => {
          setPlayersInArena(entries);
        });
      } catch (err) {
        console.error(err);
        if (active) {
          setError("Failed to join arena");
        }
      }
    };

    enterArena().catch((err) => console.error(err));

    return () => {
      active = false;
      unsubscribe?.();
      if (arenaId && player) {
        leaveArena(arenaId, player.id).catch((err) => {
          console.warn("[ArenaPage] failed to leave arena", err);
        });
      }
    };
  }, [arenaId, player]);

  const handleExit = async () => {
    if (arenaId && player) {
      await leaveArena(arenaId, player.id).catch((err) => {
        console.warn("[ArenaPage] failed to leave arena", err);
      });
    }
    navigate("/");
  };

  const playerNames = playersInArena.map((p) => p.codename);

  return (
    <div style={{ minHeight: "100vh", background: "#0f1115", color: "#e6e6e6" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
        }}
      >
        <button type="button" onClick={handleExit} style={{ color: "#7dd3fc" }}>
          ← Exit Arena
        </button>
        <div>
          <strong>{arena?.name ?? "Arena"}</strong>
          {arena?.description ? <p style={{ margin: 0 }}>{arena.description}</p> : null}
        </div>
        <div style={{ textAlign: "right", maxWidth: "200px" }}>
          <span style={{ display: "block", fontSize: 12, color: "#9CA3AF" }}>Agents Present</span>
          <span>{playerNames.length > 0 ? playerNames.join(", ") : "None"}</span>
        </div>
      </header>

      {error ? (
        <div style={{ padding: "16px", color: "#fca5a5" }}>{error}</div>
      ) : null}

      <main style={{ padding: "32px", textAlign: "center" }}>
        <h2>Multiplayer combat coming soon</h2>
        <p>Stay frosty, Agent. For now, use the training mode to hone your skills.</p>
      </main>
    </div>
  );
};

export default ArenaPage;
