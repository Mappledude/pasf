import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";

import { initArenaPlayerState } from "../firebase";
import { makeGame } from "../game/phaserGame";
import ArenaScene, { type ArenaSceneConfig } from "../game/arena/ArenaScene";
import { startHostLoop, type HostLoopController } from "../game/net/hostLoop";
import { initActionBus, disposeActionBus } from "../net/ActionBus";
import { createKeyBinder } from "../game/input/KeyBinder";
import type { ArenaPresenceEntry } from "../types/models";

const DEBUG = import.meta.env.DEV && import.meta.env.VITE_DEBUG_ARENA_PAGE === "true";

export interface UseArenaRuntimeOptions {
  arenaId?: string;
  authReady: boolean;
  stateReady: boolean;
  meUid?: string | null;
  codename?: string | null;
  presence: ArenaPresenceEntry[];
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
  const { arenaId, authReady, stateReady, meUid, codename, presence, canvasRef, onBootError } = options;

  const gameRef = useRef<Phaser.Game | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const hostLoopRef = useRef<HostLoopController | null>(null);
  const hostContextRef = useRef<string | null>(null);
  const keyBinderRef = useRef<ReturnType<typeof createKeyBinder> | null>(null);
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

    if (hostLoopRef.current) {
      hostLoopRef.current.stop();
      hostLoopRef.current = null;
    }
    hostContextRef.current = null;

    if (keyBinderRef.current) {
      keyBinderRef.current.dispose();
      keyBinderRef.current = null;
    }

    disposeActionBus();
    setGameBooted(false);
  }, []);

  useEffect(() => teardown, [teardown]);

  const shouldBoot = useMemo(() => Boolean(arenaId && authReady && stateReady && meUid), [arenaId, authReady, stateReady, meUid]);

  useEffect(() => {
    if (!shouldBoot || !arenaId || !meUid) {
      if (keyBinderRef.current) {
        keyBinderRef.current.dispose();
        keyBinderRef.current = null;
      }
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    if (!keyBinderRef.current) {
      keyBinderRef.current = createKeyBinder(window);
    }

    return () => {
      if (keyBinderRef.current) {
        keyBinderRef.current.dispose();
        keyBinderRef.current = null;
      }
    };
  }, [arenaId, meUid, shouldBoot]);

  useEffect(() => {
    if (!shouldBoot || !arenaId || !meUid) {
      disposeActionBus();
      return;
    }

    const playerCodename = codename ?? meUid.slice(0, 6);

    let cancelled = false;

    (async () => {
      try {
        await initActionBus({ arenaId, playerId: meUid, codename: playerCodename });
      } catch (error) {
        if (!cancelled && DEBUG) {
          console.warn("[ARENA] action bus init failed", error);
        }
      }
    })();

    return () => {
      cancelled = true;
      disposeActionBus();
    };
  }, [arenaId, codename, meUid, shouldBoot]);

  const hostEntry = useMemo(() => {
    if (!presence.length) return null;
    const parseTs = (value?: string) => {
      if (!value) return Number.POSITIVE_INFINITY;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };
    return [...presence].sort((a, b) => {
      const aTs = parseTs(a.joinedAt);
      const bTs = parseTs(b.joinedAt);
      if (aTs !== bTs) return aTs - bTs;
      const aKey = a.playerId ?? a.authUid ?? "";
      const bKey = b.playerId ?? b.authUid ?? "";
      return aKey.localeCompare(bKey);
    })[0];
  }, [presence]);

  const hostAuthUid = hostEntry?.authUid ?? null;
  const hostPlayerId = hostEntry?.playerId ?? null;
  const isHost = Boolean(meUid && hostAuthUid && hostAuthUid === meUid);

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

    const boot = async () => {
      const playerId = meUid!;
      const playerCodename = codename ?? playerId.slice(0, 6);
      const spawn = { x: 240, y: 540 - 40 - 60 };

      try {
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
        };

        game.scene.add("Arena", ArenaScene, true, sceneConfig);
        setGameBooted(true);

        cleanupRef.current = () => {
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
  }, [arenaId, canvasRef, codename, meUid, onBootError, shouldBoot, teardown]);

  useEffect(() => {
    if (!shouldBoot || !arenaId || !meUid) {
      if (hostLoopRef.current) {
        hostLoopRef.current.stop();
        hostLoopRef.current = null;
      }
      hostContextRef.current = null;
      return;
    }

    if (!isHost) {
      if (hostLoopRef.current) {
        hostLoopRef.current.stop();
        hostLoopRef.current = null;
      }
      hostContextRef.current = null;
      return;
    }

    const hostKey = `${arenaId}:${hostPlayerId ?? meUid}`;
    if (hostContextRef.current === hostKey && hostLoopRef.current) {
      return;
    }

    hostContextRef.current = hostKey;
    let cancelled = false;

    const playerId = meUid;
    const playerCodename = codename ?? playerId.slice(0, 6);
    const spawn = { x: 240, y: 540 - 40 - 60 };

    (async () => {
      try {
        if (DEBUG) {
          console.info("[ARENA] host bootstrap starting", { arenaId, playerId });
        }
        await initArenaPlayerState(arenaId!, { id: playerId, codename: playerCodename }, spawn);
        if (cancelled) {
          return;
        }

        if (hostLoopRef.current) {
          hostLoopRef.current.stop();
        }
        const controller = startHostLoop({
          arenaId: arenaId!,
          hostId: hostPlayerId ?? playerId,
          log: DEBUG ? console : undefined,
        });
        hostLoopRef.current = controller;
      } catch (error) {
        if (DEBUG) {
          console.error("[ARENA] host bootstrap failed", error);
        }
        if (!cancelled) {
          onBootError?.("Failed to start local host session.");
          teardown();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [arenaId, codename, hostPlayerId, isHost, meUid, onBootError, shouldBoot, teardown]);

  return { gameBooted };
}
