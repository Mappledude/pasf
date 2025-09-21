import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";

import { initArenaPlayerState } from "../firebase";
import { makeGame } from "../game/phaserGame";
import ArenaScene, { type ArenaSceneConfig } from "../game/arena/ArenaScene";
import { startHostLoop, type HostLoopController } from "../game/net/hostLoop";
import { disposeActionBus } from "../net/ActionBus";

const DEBUG = import.meta.env.DEV && import.meta.env.VITE_DEBUG_ARENA_PAGE === "true";

export interface UseArenaRuntimeOptions {
  arenaId?: string;
  authReady: boolean;
  stateReady: boolean;
  isHost: boolean;
  meUid?: string | null;
  codename?: string | null;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onBootError?: (message: string) => void;
}

export interface UseArenaRuntimeResult {
  gameBooted: boolean;
}

function destroyGame(game: Phaser.Game | null) {
  if (!game) return;
  try {
    game.destroy(true);
  } catch (error) {
    if (DEBUG) {
      console.warn("[ARENA] error destroying Phaser game", error);
    }
  }
}

export function useArenaRuntime(options: UseArenaRuntimeOptions): UseArenaRuntimeResult {
  const { arenaId, authReady, stateReady, isHost, meUid, codename, canvasRef, onBootError } = options;

  const gameRef = useRef<Phaser.Game | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [gameBooted, setGameBooted] = useState(false);

  const teardown = useCallback(() => {
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        if (DEBUG) {
          console.warn("[ARENA] runtime cleanup failed", error);
        }
      }
    } else if (gameRef.current) {
      destroyGame(gameRef.current);
      gameRef.current = null;
    }

    disposeActionBus();
    setGameBooted(false);
  }, []);

  useEffect(() => teardown, [teardown]);

  const shouldBoot = useMemo(() => {
    return Boolean(arenaId && authReady && stateReady && meUid);
  }, [arenaId, authReady, stateReady, meUid]);

  useEffect(() => {
    if (!shouldBoot) {
      teardown();
      return;
    }

    const canvasEl = canvasRef.current;
    if (!canvasEl) {
      teardown();
      return;
    }

    let cancelled = false;
    const disposers: Array<() => void> = [];

    const boot = async () => {
      const playerId = meUid!;
      const playerCodename = codename ?? playerId.slice(0, 6);
      const spawn = { x: 240, y: 540 - 40 - 60 };

      try {
        if (isHost) {
          if (DEBUG) {
            console.info("[ARENA] host bootstrap starting", { arenaId, playerId });
          }
          await initArenaPlayerState(arenaId!, { id: playerId, codename: playerCodename }, spawn);
          if (cancelled) {
            return;
          }

          const controller: HostLoopController = startHostLoop({
            arenaId: arenaId!,
            hostId: playerId,
            log: DEBUG ? console : undefined,
          });
          disposers.push(() => controller.stop());
        }

        if (cancelled) {
          return;
        }

        const config: Phaser.Types.Core.GameConfig = {
          type: Phaser.AUTO,
          width: 960,
          height: 540,
          parent: canvasEl,
          backgroundColor: "#0f1115",
          physics: {
            default: "arcade",
            arcade: { gravity: { x: 0, y: 900 }, debug: false },
          },
          scene: [],
        };

        const game = makeGame(config);
        gameRef.current = game;

        const sceneConfig: ArenaSceneConfig = {
          arenaId: arenaId!,
          me: { id: playerId, codename: playerCodename },
          spawn,
          isHostClient: isHost,
        };

        game.scene.add("Arena", ArenaScene, true, sceneConfig);
        setGameBooted(true);

        cleanupRef.current = () => {
          for (let i = disposers.length - 1; i >= 0; i -= 1) {
            const dispose = disposers[i];
            try {
              dispose();
            } catch (error) {
              if (DEBUG) {
                console.warn("[ARENA] runtime disposer failed", error);
              }
            }
          }

          if (gameRef.current === game) {
            gameRef.current = null;
          }
          destroyGame(game);
        };
      } catch (error) {
        teardown();
        if (!cancelled) {
          if (DEBUG) {
            console.error("[ARENA] failed to boot runtime", error);
          }
          onBootError?.("Failed to start local host session.");
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [arenaId, canvasRef, codename, isHost, meUid, onBootError, shouldBoot, teardown]);

  return { gameBooted };
}

