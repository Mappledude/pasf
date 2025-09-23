import React, { useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";
import { useParams } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { makeGame } from "../game/phaserGame";
import DebugDock from "../components/DebugDock";
import { useArenaRuntime } from "../utils/useArenaRuntime";
import { db } from "../firebase";
import ArenaScene, { type ArenaSceneOptions } from "../arena/ArenaScene";

const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 540;
export default function ArenaPage() {
  // Route param is /arena/:id — default to CLIFF and normalize to uppercase.
  const { arenaId: routeArenaId } = useParams<{ arenaId?: string }>();
  const arenaId = (routeArenaId ?? "CLIFF").toUpperCase();

  // Auth (for display/codename only)
  const { player } = useAuth();

  // Runtime hook provides presence + inputs (and any boot error upstream)
  const { presenceId, live, stable, enqueueInput, bootError, probeWarning, displayName: presenceDisplayName } =
    useArenaRuntime(arenaId);

  // Phaser mounts regardless of Firestore success/failure
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<ArenaScene | null>(null);

  const [gameReady, setGameReady] = useState(false);
  const [gameBootError, setGameBootError] = useState<string | null>(null);

  const sceneDisplayName = useMemo(() => {
    if (presenceDisplayName?.trim()) return presenceDisplayName.trim();
    if (player?.displayName?.trim()) return player.displayName.trim();
    if (player?.codename?.trim()) return player.codename.trim();
    return "Agent";
  }, [player?.codename, player?.displayName, presenceDisplayName]);

  // Boot Phaser (unconditional); never block canvas on Firestore
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    setGameReady(false);
    setGameBootError(null);

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      parent: container,
      backgroundColor: "#0a0a0a",
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
      scene: [],
    };

    try {
      console.info("[ARENA] phaser-boot", { arenaId });
      const game = makeGame(config);
      gameRef.current = game;
      if (!disposed) setGameReady(true);
    } catch (err) {
      console.error("[ARENA] phaser-boot-failed", err);
      if (!disposed) setGameBootError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      if (!disposed) setGameReady(false);
      disposed = true;
      const game = gameRef.current;
      if (game) {
        console.info("[ARENA] phaser-destroy");
        try {
          const existing = sceneRef.current;
          if (existing) {
            const key = existing.scene.key;
            try {
              if (game.scene.isActive(key)) {
                game.scene.stop(key);
              }
            } catch (stopErr) {
              console.warn("[ARENA] scene-stop-failed", stopErr);
            }
            try {
              game.scene.remove(key);
            } catch (removeErr) {
              console.warn("[ARENA] scene-remove-failed", removeErr);
            }
            sceneRef.current = null;
          }
        } catch (sceneErr) {
          console.warn("[ARENA] scene-cleanup-skipped", sceneErr);
        }
        game.destroy(true);
        gameRef.current = null;
      }
    };
  }, [arenaId]);

  // Mount the arena actor scene once presence is ready and the game exists
  useEffect(() => {
    const game = gameRef.current;
    if (!game || !gameReady) {
      return () => {};
    }

    if (!presenceId) {
      if (sceneRef.current) {
        const existing = sceneRef.current;
        const key = existing.scene.key;
        try {
          if (game.scene.isActive(key)) {
            game.scene.stop(key);
          }
        } catch (stopErr) {
          console.warn("[ARENA] scene-stop-failed", stopErr);
        }
        try {
          game.scene.remove(key);
        } catch (removeErr) {
          console.warn("[ARENA] scene-remove-failed", removeErr);
        }
        sceneRef.current = null;
      }
      return () => {};
    }

    const opts: ArenaSceneOptions = {
      db,
      arenaId,
      uid: presenceId,
      dn: sceneDisplayName,
    };

    const existing = sceneRef.current;
    if (existing) {
      existing.updateOptions(opts);
      return () => {};
    }

    const scene = new ArenaScene(opts);
    try {
      game.scene.add("arena", scene, true);
      sceneRef.current = scene;
    } catch (error) {
      console.error("[ARENA] scene-add-failed", error);
      setGameBootError(error instanceof Error ? error.message : String(error));
    }

    return () => {
      if (sceneRef.current !== scene) {
        return;
      }
      const key = scene.scene.key;
      try {
        if (game.scene.isActive(key)) {
          game.scene.stop(key);
        }
      } catch (stopErr) {
        console.warn("[ARENA] scene-stop-failed", stopErr);
      }
      try {
        game.scene.remove(key);
      } catch (removeErr) {
        console.warn("[ARENA] scene-remove-failed", removeErr);
      }
      sceneRef.current = null;
    };
  }, [arenaId, sceneDisplayName, gameReady, presenceId]);

  // Non-blocking overlay to surface boot/runtime status
  const overlayState = useMemo(() => {
    if (gameBootError) return { tone: "error" as const, message: `Renderer offline: ${gameBootError}` };
    if (!gameReady) return { tone: "info" as const, message: "Booting arena renderer…" };
    if (!presenceId) {
      if (bootError) {
        return { tone: "error" as const, message: `Arena bootstrap failed: ${bootError}` };
      }
      return { tone: "info" as const, message: "Linking presence channel…" };
    }
    return null;
  }, [bootError, gameBootError, gameReady, presenceId]);

  const showProbeBanner = probeWarning;

  return (
    <>
      <div className="arena-status">
        <h1>Arena {arenaId}</h1>
        <p>Players online: {live.length}</p>
        <p>{stable ? "Ready for combat" : "Waiting for rivals"}</p>
        <p className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
          Presence: {presenceId ?? "connecting"}
        </p>
        <button type="button" onClick={() => enqueueInput?.({ type: "move", dx: 1 })}>
          Move ➡️
        </button>
      </div>

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginBottom: 12 }}>Arena Feed</h2>
        {showProbeBanner && (
          <div
            role="status"
            className="my-3"
            style={{
              padding: "8px 12px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
              color: "#f87171",
              border: "1px solid rgba(248,113,113,0.35)",
              borderRadius: 8,
              background: "rgba(15,17,21,0.6)",
            }}
          >
            Arena rules probe hit a protected path (non-fatal). Presence continues, but server seeding may be limited.
          </div>
        )}
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
          <div ref={containerRef} style={{ width: ARENA_WIDTH, height: ARENA_HEIGHT, margin: "0 auto" }} />
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
