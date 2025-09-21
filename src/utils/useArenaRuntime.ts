import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";

import { makeGame } from "../game/phaserGame";
import ArenaScene, { type ArenaSceneConfig } from "../game/arena/ArenaScene";
import { startHostLoop, type HostLoopController } from "../game/net/hostLoop";
import { initActionBus, disposeActionBus } from "../net/ActionBus";
import { createKeyBinder } from "../game/input/KeyBinder";
import type { ArenaPresenceEntry } from "../types/models";
import { writeArenaWriter } from "../firebase";
import { isPresenceEntryActive } from "./presenceThresholds";

const DEBUG = import.meta.env.DEV && import.meta.env.VITE_DEBUG_ARENA_PAGE === "true";

export interface UseArenaRuntimeOptions {
  arenaId?: string;
  authReady: boolean;
  stateReady: boolean;
  meUid?: string | null;
  codename?: string | null;
  presence: ArenaPresenceEntry[];
  writerUid?: string | null;
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
  const {
    arenaId,
    authReady,
    stateReady,
    meUid,
    codename,
    presence,
    writerUid: stateWriterUid,
    canvasRef,
    onBootError,
  } = options;

  const gameRef = useRef<Phaser.Game | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const hostLoopRef = useRef<HostLoopController | null>(null);
  const hostContextRef = useRef<string | null>(null);
  const keyBinderRef = useRef<ReturnType<typeof createKeyBinder> | null>(null);
  const hostLogRef = useRef<string | null>(null);
  const [gameBooted, setGameBooted] = useState(false);
  const writerLogRef = useRef<string | null>(null);
  const writerPersistRef = useRef<string | null>(null);

  const activePresence = useMemo(() => {
    const now = Date.now();
    return presence.filter((entry) => {
      const uid = entry.authUid ?? entry.playerId;
      if (!uid) return false;
      return isPresenceEntryActive(entry, now);
    });
  }, [presence]);

  const stateWriterEntry = useMemo(() => {
    if (!stateWriterUid) return null;
    return (
      presence.find((entry) => {
        const uid = entry.authUid ?? entry.playerId;
        return uid === stateWriterUid;
      }) ?? null
    );
  }, [presence, stateWriterUid]);

  const stateWriterActive = useMemo(() => {
    if (!stateWriterEntry) return false;
    return isPresenceEntryActive(stateWriterEntry);
  }, [stateWriterEntry]);

  const electedWriterUid = useMemo(() => {
    const byUid = new Map(
      activePresence
        .map((entry) => [entry.authUid ?? entry.playerId ?? "", entry] as const)
        .filter((pair): pair is readonly [string, ArenaPresenceEntry] => pair[0].length > 0),
    );
    if (stateWriterUid && stateWriterActive) {
      return stateWriterUid;
    }
    if (byUid.size > 0) {
      const sorted = [...byUid.values()].sort((a, b) => {
        const parseTs = (value?: string) => {
          if (!value) return Number.POSITIVE_INFINITY;
          const parsed = Date.parse(value);
          return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
        };
        const aTs = parseTs(a.joinedAt);
        const bTs = parseTs(b.joinedAt);
        if (aTs !== bTs) return aTs - bTs;
        const aKey = (a.authUid ?? a.playerId ?? "").toString();
        const bKey = (b.authUid ?? b.playerId ?? "").toString();
        return aKey.localeCompare(bKey);
      });
      const first = sorted[0];
      if (first) {
        return first.authUid ?? first.playerId ?? null;
      }
    }
    return stateWriterUid ?? null;
  }, [activePresence, stateWriterActive, stateWriterUid]);

  const writerEntry = useMemo(() => {
    if (!electedWriterUid) return null;
    return presence.find((entry) => {
      const uid = entry.authUid ?? entry.playerId;
      return uid === electedWriterUid;
    }) ?? null;
  }, [electedWriterUid, presence]);

  useEffect(() => {
    if (!arenaId) return;
    const logKey = electedWriterUid ?? "(none)";
    if (writerLogRef.current === logKey) {
      return;
    }
    writerLogRef.current = logKey;
    if (DEBUG) {
      console.info(`[WRITER] elected uid=${logKey}`);
    }
  }, [arenaId, electedWriterUid]);

  useEffect(() => {
    if (!arenaId) return;
    if (!meUid) return;
    if (electedWriterUid !== meUid) {
      writerPersistRef.current = null;
      return;
    }
    if (stateWriterUid === electedWriterUid) {
      return;
    }
    if (writerPersistRef.current === electedWriterUid) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await writeArenaWriter(arenaId, electedWriterUid);
        if (!cancelled) {
          writerPersistRef.current = electedWriterUid;
        }
      } catch (error) {
        if (!cancelled && DEBUG) {
          console.warn("[WRITER] failed to persist", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arenaId, electedWriterUid, meUid, stateWriterUid]);

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

  const writerUid = electedWriterUid;
  const isWriter = Boolean(meUid && writerUid && writerUid === meUid);

  useEffect(() => {
    if (!arenaId) return;
    const joinedAt = writerEntry?.joinedAt ?? null;
    const logKey = writerEntry ? `${writerEntry.authUid ?? "(unknown)"}|${joinedAt ?? "(missing)"}` : "none";
    if (hostLogRef.current === logKey) {
      return;
    }
    hostLogRef.current = logKey;
    if (DEBUG && writerEntry) {
      console.info(
        `[HOST] writer details authUid=${writerEntry.authUid ?? "(unknown)"} playerId=${writerEntry.playerId ?? "(unknown)"} joinedAt=${joinedAt ?? "(missing)"} lastSeen=${writerEntry.lastSeen ?? "(missing)"}`,
      );
    }
  }, [arenaId, writerEntry, writerEntry?.authUid, writerEntry?.joinedAt, writerEntry?.lastSeen, writerEntry?.playerId]);

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

    if (!isWriter) {
      if (hostLoopRef.current) {
        hostLoopRef.current.stop();
        hostLoopRef.current = null;
      }
      hostContextRef.current = null;
      return;
    }

    const hostKey = `${arenaId}:${writerUid ?? meUid}`;
    if (hostContextRef.current === hostKey && hostLoopRef.current) {
      return;
    }

    hostContextRef.current = hostKey;
    let cancelled = false;

    (async () => {
      try {
        if (DEBUG) {
          console.info("[ARENA] host bootstrap starting", { arenaId, playerId: meUid });
        }
        if (hostLoopRef.current) {
          hostLoopRef.current.stop();
        }
        const controller = startHostLoop({
          arenaId: arenaId!,
          writerUid: writerUid ?? meUid!,
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
  }, [arenaId, isWriter, meUid, onBootError, shouldBoot, teardown, writerUid]);

  return { gameBooted };
}
