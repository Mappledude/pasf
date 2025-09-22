import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

import { makeGame } from "../game/phaserGame";
import ArenaScene, { type ArenaSceneConfig } from "../game/arena/ArenaScene";
import { startHostLoop, type HostLoopController } from "../game/net/hostLoop";
import { initInputPublisher, disposeInputPublisher } from "../net/InputPublisher";
import { createKeyBinder } from "../game/input/KeyBinder";
import type { ArenaPresenceEntry } from "../types/models";
import { db, writeArenaWriter } from "../firebase";
import { startPresenceHeartbeat, watchArenaPresence, type LivePresence } from "../lib/presence";
import { dbg } from "../lib/debug";

const DEBUG = import.meta.env.DEV && import.meta.env.VITE_DEBUG_ARENA_PAGE === "true";
const ONLINE_WINDOW_MS = 20_000;
const PRESENCE_WRITER_TICK_MS = 1000 / 12;

interface ActivePresenceInfo {
  presenceId: string;
  authUid: string;
  lastSeenMs: number;
  entry: ArenaPresenceEntry;
}

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
  presenceId: string | null;
  isWriter: boolean;
  liveCount: number;
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
  const [livePresence, setLivePresence] = useState<LivePresence[]>([]);
  const presenceWriterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Presence bookkeeping ----

  const myPresenceEntry = useMemo(() => {
    if (!meUid) return null;
    return presence.find((entry) => entry.authUid === meUid) ?? null;
  }, [meUid, presence]);

  const myPresenceId = myPresenceEntry?.presenceId ?? null;

  useEffect(() => {
    if (!arenaId) return;
    if (!myPresenceId) return;
    if (!meUid) return;
    const stop = startPresenceHeartbeat(arenaId, myPresenceId, meUid);
    return () => {
      stop?.();
    };
  }, [arenaId, meUid, myPresenceId]);

  useEffect(() => {
    if (!arenaId) {
      setLivePresence([]);
      return;
    }
    return watchArenaPresence(arenaId, setLivePresence);
  }, [arenaId]);

  const activePresence = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, ActivePresenceInfo>();
    for (const entry of presence) {
      const presenceId = entry.presenceId ?? entry.playerId;
      const authUid = entry.authUid ?? entry.playerId;
      if (!presenceId || !authUid) continue;

      const rawLastSeen = entry.lastSeen;
      const lastSeenMs =
        typeof rawLastSeen === "number"
          ? rawLastSeen
          : rawLastSeen
          ? Date.parse(rawLastSeen)
          : Number.NaN;
      if (!Number.isFinite(lastSeenMs)) continue;
      if (now - lastSeenMs > ONLINE_WINDOW_MS) continue;

      map.set(presenceId, { presenceId, authUid, lastSeenMs, entry });
    }
    return map;
  }, [presence]);

  const activeByAuthUid = useMemo(() => {
    const map = new Map<string, ActivePresenceInfo>();
    for (const info of activePresence.values()) {
      if (!map.has(info.authUid)) {
        map.set(info.authUid, info);
      }
    }
    return map;
  }, [activePresence]);

  const presenceWriterId = useMemo(() => {
    if (!livePresence.length) return null;
    const sorted = [...livePresence].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
    return sorted[0]?.id ?? null;
  }, [livePresence]);

  const isPresenceWriter = Boolean(myPresenceId && presenceWriterId && presenceWriterId === myPresenceId);

  // ---- Writer election (prefer state, fall back to lexicographic) ----

  const stateWriterInfo = useMemo(() => {
    if (!stateWriterUid) return null;
    return activeByAuthUid.get(stateWriterUid) ?? null;
  }, [activeByAuthUid, stateWriterUid]);

  const electedWriterInfo = useMemo(() => {
    if (stateWriterInfo) return stateWriterInfo;
    const sorted = [...activePresence.values()].sort((a, b) => a.authUid.localeCompare(b.authUid));
    return sorted[0] ?? null;
  }, [activePresence, stateWriterInfo]);

  const writerEntry = electedWriterInfo?.entry ?? null;
  const electedWriterUid = electedWriterInfo?.authUid ?? null;
  const electedWriterPresenceId = electedWriterInfo?.presenceId ?? null;

  // ---- Logging elected writer changes ----

  useEffect(() => {
    if (!arenaId) return;
    const logKey = electedWriterUid ?? "(none)";
    if (writerLogRef.current === logKey) return;
    writerLogRef.current = logKey;
    if (DEBUG) {
      console.info(`[WRITER] elected ${logKey}`);
    }
  }, [arenaId, electedWriterUid]);

  useEffect(() => {
    if (!arenaId) return;
    if (!isPresenceWriter) {
      if (presenceWriterRef.current) {
        clearInterval(presenceWriterRef.current);
        presenceWriterRef.current = null;
      }
      return;
    }
    if (presenceWriterRef.current) {
      return;
    }

    if (DEBUG) {
      console.info("[WRITER] presence elected", { presenceId: myPresenceId });
    }

    presenceWriterRef.current = setInterval(() => {
      const entities = livePresence.reduce<Record<string, { id: string }>>((acc, p) => {
        if (!p.id) return acc;
        acc[p.id] = { id: p.id };
        return acc;
      }, {});

      setDoc(doc(db, "arenas", arenaId, "state", "current"), {
        entities,
        ts: Date.now(),
      }, { merge: true })
        .then(() => {
          if (DEBUG) {
            console.info("[STATE] wrote");
          }
        })
        .catch((error) => {
          console.info("[STATE] write error", error);
        });
    }, PRESENCE_WRITER_TICK_MS);

    return () => {
      if (presenceWriterRef.current) {
        clearInterval(presenceWriterRef.current);
        presenceWriterRef.current = null;
      }
      if (DEBUG) {
        console.info("[WRITER] presence released");
      }
    };
  }, [arenaId, isPresenceWriter, livePresence, myPresenceId]);

  // Persist writer to /state/current if I'm the elected writer but state hasn't recorded it yet
  useEffect(() => {
    if (!arenaId) return;
    if (!meUid) return;
    if (electedWriterUid !== meUid) {
      writerPersistRef.current = null;
      return;
    }
    if (stateWriterUid === electedWriterUid) return;
    if (writerPersistRef.current === electedWriterUid) return;

    let cancelled = false;
    (async () => {
      try {
        await writeArenaWriter(arenaId, electedWriterUid!);
        if (!cancelled) {
          writerPersistRef.current = electedWriterUid!;
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

  // ---- Teardown helper ----

  const teardown = useCallback(() => {
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        if (DEBUG) console.warn("[ARENA] runtime cleanup failed", error);
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

    disposeInputPublisher();
    setGameBooted(false);
  }, []);

  useEffect(() => teardown, [teardown]);

  // ---- Boot gating ----

  const shouldBoot = useMemo(
    () => Boolean(arenaId && authReady && stateReady && meUid && myPresenceId),
    [arenaId, authReady, myPresenceId, stateReady, meUid],
  );

  // Key binder lifecycle
  useEffect(() => {
    if (!shouldBoot || !arenaId || !meUid) {
      if (keyBinderRef.current) {
        keyBinderRef.current.dispose();
        keyBinderRef.current = null;
      }
      return;
    }

    if (typeof window === "undefined") return;

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

  // ActionBus lifecycle (session-scoped presenceId)
  useEffect(() => {
    if (!shouldBoot || !arenaId || !meUid || !myPresenceId) {
      disposeInputPublisher();
      return;
    }

    const playerCodename = codename ?? myPresenceId.slice(0, 6);
    let cancelled = false;

    (async () => {
      try {
        await initInputPublisher({
          arenaId,
          presenceId: myPresenceId,
          codename: playerCodename,
        });
      } catch (error) {
        if (!cancelled && DEBUG) {
          console.warn("[ARENA] action bus init failed", error);
        }
      }
    })();

    return () => {
      cancelled = true;
      disposeInputPublisher();
    };
  }, [arenaId, codename, meUid, myPresenceId, shouldBoot]);

  // Host writer detail log (optional)
  useEffect(() => {
    if (!arenaId) return;
    const joinedAt = writerEntry?.joinedAt ?? null;
    const logKey = writerEntry ? `${writerEntry.authUid ?? "(unknown)"}|${joinedAt ?? "(missing)"}` : "none";
    if (hostLogRef.current === logKey) return;
    hostLogRef.current = logKey;
    if (DEBUG && writerEntry) {
      console.info(
        `[HOST] writer details authUid=${writerEntry.authUid ?? "(unknown)"} playerId=${writerEntry.playerId ?? "(unknown)"} joinedAt=${joinedAt ?? "(missing)"} lastSeen=${writerEntry.lastSeen ?? "(missing)"}`,
      );
    }
  }, [arenaId, writerEntry, writerEntry?.authUid, writerEntry?.joinedAt, writerEntry?.lastSeen, writerEntry?.playerId]);

  // Boot Phaser + scene
  useEffect(() => {
    if (!shouldBoot || !myPresenceId) {
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
      const playerId = myPresenceId!;
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
          me: { id: playerId, codename: playerCodename, authUid: meUid! },
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
          if (DEBUG) console.error("[ARENA] failed to boot runtime", error);
          onBootError?.("Failed to start local host session.");
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [arenaId, canvasRef, codename, meUid, myPresenceId, onBootError, shouldBoot, teardown]);

  // Host loop lifecycle (only if I'm the elected writer)
  const writerUid = electedWriterUid;
  const isWriter = Boolean(meUid && writerUid && writerUid === meUid);

  useEffect(() => {
    if (!arenaId || !myPresenceId) return;
    dbg("writer:election", { arenaId, me: myPresenceId, isWriter, live: livePresence.length });
  }, [arenaId, isWriter, livePresence.length, myPresenceId]);

  useEffect(() => {
    if (!shouldBoot || !arenaId || !meUid) {
      if (hostLoopRef.current) {
        hostLoopRef.current.stop();
        hostLoopRef.current = null;
      }
      hostContextRef.current = null;
      return;
    }

    if (!isWriter || !electedWriterPresenceId || !electedWriterUid) {
      if (hostLoopRef.current) {
        hostLoopRef.current.stop();
        hostLoopRef.current = null;
      }
      hostContextRef.current = null;
      return;
    }

    const hostKey = `${arenaId}:${electedWriterPresenceId}:${electedWriterUid}`;
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
          writerAuthUid: electedWriterUid!,
          writerPresenceId: electedWriterPresenceId!,
          log: DEBUG ? console : undefined,
        });
        hostLoopRef.current = controller;
      } catch (error) {
        if (DEBUG) console.error("[ARENA] host bootstrap failed", error);
        if (!cancelled) {
          onBootError?.("Failed to start local host session.");
          teardown();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    arenaId,
    electedWriterPresenceId,
    electedWriterUid,
    isWriter,
    meUid,
    myPresenceId,
    onBootError,
    shouldBoot,
    teardown,
  ]);

  useEffect(() => {
    if (!arenaId) return;
    const ref = doc(db, "arenas", arenaId, "state", "current");
    return onSnapshot(ref, (snapshot) => {
      const data = snapshot.data();
      if (data) {
        console.info("[STATE] snapshot", { ts: (data as { ts?: unknown }).ts });
      }
      dbg("state:snapshot", { arenaId, hasData: !!data, ts: (data as { ts?: unknown })?.ts });
    });
  }, [arenaId]);

  return {
    gameBooted,
    presenceId: myPresenceId,
    isWriter: isPresenceWriter,
    liveCount: livePresence.length,
  };
}
