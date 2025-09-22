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
  // Route param is /arena/:id — default to CLIFF and normalize to uppercase.
  const params = useParams<{ id?: string }>();
  const arenaId = (params.id ?? "CLIFF").toUpperCase();

  // Auth (for display/codename only)
  const { user, player } = useAuth();

  // Runtime hook provides presence + inputs (and any boot error upstream)
  const { presenceId, live, stable, enqueueInput, bootError } = useArenaRuntime(arenaId);

  // Phaser mounts regardless of Firestore success/failure
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const latestConfigRef = useRef<ArenaSceneConfig>();

  const [sceneBooted, setSceneBooted] = useState(false);
  const [gameBootError, setGameBootError] = useState<string | null>(null);

  const codename = useMemo(() => {
    if (player?.codename?.trim()) return player.codename.trim();
    if (player?.displayName?.trim()) return player.displayName.trim();
    return "Agent";
  }, [player?.codename, player?.displayName]);

  const meAuthUid = user?.uid ?? null;
  const meId = presenceId ?? meAuthUid ?? `local-${arenaId}`;

  const sceneConfig = useMemo<ArenaSceneConfig>(
    () => ({
      arenaId,
      me: { id: meId, codename, authUid: meAuthUid ?? undefined },
      spawn: { ...DEFAULT_SPAWN },
    }),
    [arenaId, codename, meAuthUid, meId],
  );

  // Keep the latest scene config in a ref for safe restarts
  useEffect(() => {
    latestConfigRef.current = sceneConfig;
  }, [sceneConfig]);

  // Boot Phaser (unconditional); never block canvas on Firestore
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      console.info("[ARENA] phaser-boot", { arenaId });
      const game = makeGame(config);
      gameRef.current = game;
      const payload = latestConfigRef.current ?? sceneConfig;
      game.scene.add("Arena", ArenaScene, true, payload);
      if (!disposed) setSceneBooted(true);
    } catch (err) {
      console.error("[ARENA] phaser-boot-failed", err);
      if (!disposed) setGameBootError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      if (!disposed) setSceneBooted(false);
      disposed = true;
      const game = gameRef.current;
      if (game) {
        console.info("[ARENA] phaser-destroy");
        game.destroy(true);
        gameRef.current = null;
      }
    };
  }, [arenaId]);

  // If config changes after boot, restart the scene with the new payload
  useEffect(() => {
    if (!sceneBooted) return;
    const game = gameRef.current;
    if (!game) return;
    const payload = latestConfigRef.current ?? sceneConfig;
    const arenaScene = game.scene.getScene("Arena");
    if (!arenaScene) return;
    console.info("[ARENA] scene-restart", { arenaId: payload.arenaId, meId: payload.me.id });
    arenaScene.scene.restart(payload);
  }, [sceneBooted, sceneConfig]);

  // Non-blocking overlay to surface boot/runtime status
  const overlayState = useMemo(() => {
    if (gameBootError) return { tone: "error" as const, message: `Renderer offline: ${gameBootError}` };
    if (bootError) return { tone: "error" as const, message: `Arena bootstrap failed: ${bootError}` };
    if (!sceneBooted) return { tone: "info" as const, message: "Booting arena renderer…" };
    if (!presenceId) return { tone: "info" as const, message: "Linking presence channel…" };
    return null;
  }, [bootError, gameBootError, presenceId, sceneBooted]);

  const permDenied = (bootError ?? "").toLowerCase().includes("permission");

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
        {permDenied && (
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
            Arena bootstrap failed (permissions). Gameplay may be local-only until rules/App Check are enforced.
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
          {!permDenied && overlayState ? (
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
