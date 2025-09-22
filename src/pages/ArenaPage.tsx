import React, { useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";
import { useParams } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { makeGame } from "../game/phaserGame";
import ArenaScene, { type ArenaSceneConfig } from "../game/arena/ArenaScene";
import DebugDock from "../components/DebugDock";
import { useArenaRuntime } from "../utils/useArenaRuntime";

const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 540;
const ARENA_GROUND_HEIGHT = 40;
const PLAYER_FLOOR_OFFSET = 60;
const DEFAULT_SPAWN = {
  x: 240,
  y: ARENA_HEIGHT - ARENA_GROUND_HEIGHT - PLAYER_FLOOR_OFFSET,
};

export default function ArenaPage() {
  const params = useParams<{ id: string }>();
  const arenaId = (params.id ?? "CLIFF").toUpperCase();
  const { user, player } = useAuth();
  const { presenceId, live, stable, enqueueInput, bootError } = useArenaRuntime(arenaId);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const latestConfigRef = useRef<ArenaSceneConfig>();

  const [sceneBooted, setSceneBooted] = useState(false);
  const [gameBootError, setGameBootError] = useState<string | null>(null);

  const codename = useMemo(() => {
    if (player?.codename && player.codename.trim().length > 0) {
      return player.codename.trim();
    }
    if (player?.displayName && player.displayName.trim().length > 0) {
      return player.displayName.trim();
    }
    return "Agent";
  }, [player?.codename, player?.displayName]);

  const meAuthUid = user?.uid;
  const meId = presenceId ?? meAuthUid ?? `local-${arenaId}`;

  const sceneConfig = useMemo<ArenaSceneConfig>(
    () => ({
      arenaId,
      me: { id: meId, codename, authUid: meAuthUid },
      spawn: { ...DEFAULT_SPAWN },
    }),
    [arenaId, codename, meAuthUid, meId],
  );

  useEffect(() => {
    latestConfigRef.current = sceneConfig;
  }, [sceneConfig]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    setSceneBooted(false);
    setGameBootError(null);

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      parent: container,
      backgroundColor: "#0a0a0a",
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 900 }, debug: false } },
      scene: [],
    };

    try {
      console.info("[ArenaPage] booting Phaser", { arenaId });
      const game = makeGame(config);
      gameRef.current = game;
      const configPayload = latestConfigRef.current ?? sceneConfig;
      game.scene.add("Arena", ArenaScene, true, configPayload);
      if (!disposed) {
        setSceneBooted(true);
      }
    } catch (err) {
      console.error("[ArenaPage] failed to boot Phaser", err);
      if (!disposed) {
        setGameBootError(err instanceof Error ? err.message : String(err));
      }
    }

    return () => {
      if (!disposed) {
        setSceneBooted(false);
        disposed = true;
      }
      const game = gameRef.current;
      if (game) {
        console.info("[ArenaPage] destroying Phaser");
        game.destroy(true);
        gameRef.current = null;
      }
    };
  }, [arenaId]);

  useEffect(() => {
    if (!sceneBooted) {
      return;
    }
    const game = gameRef.current;
    if (!game) {
      return;
    }
    const configPayload = latestConfigRef.current ?? sceneConfig;
    const arenaScene = game.scene.getScene("Arena");
    if (!arenaScene) {
      return;
    }
    console.info("[ArenaPage] refreshing Arena scene", {
      arenaId: configPayload.arenaId,
      meId: configPayload.me.id,
    });
    arenaScene.scene.restart(configPayload);
  }, [sceneBooted, sceneConfig]);

  const overlayState = useMemo(() => {
    if (gameBootError) {
      return { tone: "error" as const, message: `Renderer offline: ${gameBootError}` };
    }
    if (bootError) {
      return { tone: "error" as const, message: `Arena bootstrap failed: ${bootError}` };
    }
    if (!sceneBooted) {
      return { tone: "info" as const, message: "Booting arena renderer…" };
    }
    if (!presenceId) {
      return { tone: "info" as const, message: "Linking presence channel…" };
    }
    return null;
  }, [bootError, gameBootError, presenceId, sceneBooted]);

  return (
    <>
      <div className="arena-status">
        <h1>Arena {arenaId}</h1>
        <p>Players online: {live.length}</p>
        <p>{stable ? "Ready for combat" : "Waiting for rivals"}</p>
        <p className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
          Presence: {presenceId ?? "connecting"}
        </p>
        <button type="button" onClick={() => enqueueInput({ type: "move", dx: 1 })}>
          Move ➡️
        </button>
      </div>
      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginBottom: 12 }}>Arena Feed</h2>
        <div
          className="canvas-frame"
          style={{
            position: "relative",
            minHeight: ARENA_HEIGHT,
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            background: "var(--bg-soft)",
            overflow: "hidden",
          }}
        >
          <div
            ref={containerRef}
            style={{ width: ARENA_WIDTH, height: ARENA_HEIGHT, margin: "0 auto" }}
          />
          {overlayState ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 24px",
                textAlign: "center",
                color: overlayState.tone === "error" ? "#f87171" : "#bfdbfe",
                backgroundColor:
                  overlayState.tone === "error" ? "rgba(15, 17, 21, 0.84)" : "rgba(15, 17, 21, 0.6)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.95rem",
                letterSpacing: "0.04em",
                pointerEvents: "none",
              }}
            >
              {overlayState.message}
            </div>
          ) : null}
        </div>
        <div className="card-footer">[SIM] Phaser arena scene · multiplayer feed</div>
      </section>
      <DebugDock />
    </>
  );
}

