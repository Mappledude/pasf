import React, { useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";
import { useNavigate, useParams } from "react-router-dom";
import {
  ensureAnonAuth,
  getArena,
  initArenaPlayerState,
  joinArena,
  leaveArena,
  watchArenaPresence,
} from "../firebase";
import { useAuth } from "../context/AuthContext";
import { disposeActionBus, initActionBus, publishInput } from "../net/ActionBus";
import type { Arena, ArenaPresenceEntry } from "../types/models";
import { makeGame } from "../game/phaserGame";
import ArenaScene from "../game/arena/ArenaScene";

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const SPAWN_A = { x: 240, y: 360 } as const;
const SPAWN_B = { x: 720, y: 360 } as const;

const ArenaPage: React.FC = () => {
  const { arenaId } = useParams<{ arenaId: string }>();
  const navigate = useNavigate();
  const { player, user, loading } = useAuth();

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

      <main style={{ padding: "16px" }}>
        {player && arenaId ? (
          <ArenaCanvas
            arenaId={arenaId}
            me={{ id: player.id, codename: player.codename }}
            presence={playersInArena}
            networkId={user?.uid ?? null}
          />
        ) : (
          <div style={{ padding: "24px", textAlign: "center" }}>Loading arena...</div>
        )}
      </main>
    </div>
  );
};

export default ArenaPage;

interface ArenaCanvasProps {
  arenaId: string;
  me: { id: string; codename: string };
  presence: ArenaPresenceEntry[];
  networkId: string | null;
}

const ArenaCanvas: React.FC<ArenaCanvasProps> = ({ arenaId, me, presence, networkId }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const initKeyRef = useRef<string | null>(null);
  const [stateReady, setStateReady] = useState(false);
  const [busReady, setBusReady] = useState(false);

  const spawn = useMemo(() => {
    const ids = presence.map((p) => p.playerId);
    if (!ids.includes(me.id)) {
      ids.push(me.id);
    }
    ids.sort();
    const index = ids.indexOf(me.id);
    if (index <= 0) return SPAWN_A;
    if (index === 1) return SPAWN_B;
    return index % 2 === 0 ? SPAWN_A : SPAWN_B;
  }, [presence, me.id]);

  useEffect(() => {
    if (!spawn) return;
    const key = `${arenaId}:${me.id}:${me.codename}`;
    if (initKeyRef.current === key) {
      return;
    }
    let cancelled = false;
    initKeyRef.current = key;
    setStateReady(false);
    (async () => {
      try {
        await initArenaPlayerState(arenaId, { id: me.id, codename: me.codename }, spawn);
        if (!cancelled) {
          setStateReady(true);
        }
      } catch (err) {
        console.warn("[ArenaCanvas] initArenaPlayerState failed", err);
        if (!cancelled) {
          initKeyRef.current = null;
          setStateReady(false);
        }
      }
    })().catch((err) => console.error(err));

    return () => {
      cancelled = true;
    };
  }, [arenaId, me.id, me.codename, spawn]);

  useEffect(() => {
    if (!stateReady) return;
    if (!containerRef.current) return;
    if (gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      parent: containerRef.current,
      backgroundColor: "#0f1115",
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 900 }, debug: false } },
      scene: [],
    };

    const game = makeGame(config);
    gameRef.current = game;
    const sceneData = { arenaId, me: { id: me.id, codename: me.codename }, spawn };
    game.scene.add("Arena", ArenaScene, true, sceneData);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [arenaId, me.id, me.codename, spawn, stateReady]);

  useEffect(() => {
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!stateReady || !networkId) {
      setBusReady(false);
      disposeActionBus();
      return;
    }

    let cancelled = false;
    initActionBus({
      arenaId,
      playerId: networkId,
      onRemoteAction: (action) => {
        if (cancelled) return;
        console.debug("[ArenaCanvas] remote action", action);
      },
    })
      .then(() => {
        if (!cancelled) {
          setBusReady(true);
        }
      })
      .catch((err) => {
        console.warn("[ArenaCanvas] initActionBus failed", err);
      });

    return () => {
      cancelled = true;
      setBusReady(false);
      disposeActionBus();
    };
  }, [arenaId, networkId, stateReady]);

  useEffect(() => {
    if (!busReady) return;

    const keyState: { [K in "left" | "right" | "jump" | "attack"]: boolean } = {
      left: false,
      right: false,
      jump: false,
      attack: false,
    };

    const keyToAction: Record<string, keyof typeof keyState> = {
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
      ArrowUp: "jump",
      KeyW: "jump",
      Space: "jump",
      KeyJ: "attack",
      KeyF: "attack",
      KeyK: "attack",
    };

    const updateState = (code: string, pressed: boolean) => {
      const action = keyToAction[code];
      if (!action) return;
      if (keyState[action] === pressed) return;
      keyState[action] = pressed;
      publishInput({ ...keyState });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      updateState(event.code, true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      updateState(event.code, false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [busReady]);

  const gameReady = stateReady && !!gameRef.current;

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div
        ref={containerRef}
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          background: "#0f1115",
          border: "1px solid #1f2937",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            background: "rgba(34, 197, 94, 0.15)",
            border: "1px solid rgba(34, 197, 94, 0.4)",
            color: "#34d399",
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 999,
            pointerEvents: "none",
          }}
        >
          NET: 10Hz, dedupe ON
        </div>
        {!gameReady ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9ca3af",
              fontSize: 16,
            }}
          >
            Initializing arena...
          </div>
        ) : null}
      </div>
    </div>
  );
};
