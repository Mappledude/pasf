import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";
import { onSnapshot, type DocumentReference } from "firebase/firestore";
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
import { applyActions, getSnapshot, initSim } from "../sim/reducer";
import type { ActionDoc, InputFlags, Sim, Snapshot } from "../sim/types";
import { ensureArenaState, arenaStateDoc } from "../lib/arenaState";

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const SPAWN_A = { x: 240, y: 360 } as const;
const SPAWN_B = { x: 720, y: 360 } as const;
const SIM_OPPONENT_ID = "remote-opponent";
const MAX_FRAME_DT = 100;

type RendererPlayerState = {
  x: number;
  y: number;
  hp: number;
  dir: -1 | 1;
};

type RendererSnapshot = {
  tick: number;
  tMs: number;
  me: RendererPlayerState;
  opp?: RendererPlayerState;
};

function hashSeed(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 2147483647;
  }
  return hash || 1;
}

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
    if (!arenaId || !player || !user?.uid) {
      return;
    }

    const presenceId = user.uid;
    let unsubscribe: (() => void) | undefined;
    let active = true;

    const enterArena = async () => {
      try {
        await joinArena(arenaId, presenceId, player.codename, player.id);
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
      if (arenaId) {
        leaveArena(arenaId, presenceId).catch((err) => {
          console.warn("[ArenaPage] failed to leave arena", err);
        });
      }
    };
  }, [arenaId, player, user?.uid]);

  useEffect(() => {
    if (!arenaId) return;
    console.info(`[BOOT] route arenaId=${arenaId} playerId=${user?.uid ?? "none"}`);
  }, [arenaId, user?.uid]);

  const handleExit = async () => {
    const presenceId = user?.uid ?? player?.id;
    if (arenaId && presenceId) {
      await leaveArena(arenaId, presenceId).catch((err) => {
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
  const [arenaInitError, setArenaInitError] = useState<string | null>(null);
  const [stateRef, setStateRef] = useState<DocumentReference | null>(null);
  const [stateData, setStateData] = useState<Record<string, unknown> | null>(null);
  const [busReady, setBusReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const simRef = useRef<Sim | null>(null);
  const pendingActionsRef = useRef<ActionDoc[]>([]);
  const localSeqRef = useRef(0);
  const remoteSourceRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const renderStateRef = useRef<RendererSnapshot>({
    tick: 0,
    tMs: 0,
    me: { x: SPAWN_A.x, y: SPAWN_A.y, hp: 100, dir: 1 },
  });
  const simOverlayRef = useRef<HTMLDivElement | null>(null);
  const stateReadyRef = useRef(false);
  const gameReadyRef = useRef(false);
  const rafStartedRef = useRef(false);
  const loopLogRef = useRef({ lastLog: 0, lastTick: 0 });

  const statePlayerId = useMemo(() => networkId ?? me.id, [networkId, me.id]);

  useEffect(() => {
    if (!arenaId || !networkId) {
      setStateRef(null);
      setStateReady(false);
      setStateData(null);
      setArenaInitError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await ensureArenaState(arenaId);
        if (cancelled) return;
        setArenaInitError(null);
        setStateRef(arenaStateDoc(arenaId));
      } catch (err) {
        console.error("[arena] ensureArenaState failed:", err);
        if (cancelled) return;
        setStateRef(null);
        setStateReady(false);
        setStateData(null);
        setArenaInitError(err instanceof Error ? err.message : String(err));
      }
    })().catch((err) => {
      console.error("[arena] ensureArenaState threw:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [arenaId, networkId]);

  useEffect(() => {
    if (!stateRef) {
      setStateReady(false);
      setStateData(null);
      return;
    }

    const unsubscribe = onSnapshot(
      stateRef,
      (snap) => {
        const exists = snap.exists();
        setStateReady(exists);
        setStateData(exists ? (snap.data() as Record<string, unknown>) : null);
        if (!exists) {
          return;
        }
        setArenaInitError(null);
      },
      (err) => {
        console.error("[arena] state subscription error:", err);
        setArenaInitError(err instanceof Error ? err.message : String(err));
      },
    );

    return () => {
      unsubscribe();
    };
  }, [stateRef]);

  const checkGameReady = useCallback(
    (tick: number) => {
      const readyByTick = tick >= 1;
      const readyByState = stateReadyRef.current && !!gameRef.current;
      if ((readyByTick || readyByState) && !gameReadyRef.current) {
        gameReadyRef.current = true;
        setGameReady(true);
        console.info("[BOOT] gameReady=true");
      }
    },
    [],
  );

  const queueLocalAction = useCallback(
    (input: InputFlags) => {
      const sim = simRef.current;
      if (!sim) return;
      const seq = (localSeqRef.current += 1);
      pendingActionsRef.current.push({
        arenaId,
        playerId: sim.myId,
        seq,
        input: {
          left: !!input.left,
          right: !!input.right,
          jump: !!input.jump,
          attack: !!input.attack,
        },
        clientTs: Date.now(),
      });
    },
    [arenaId],
  );

  const updateRenderState = useCallback(
    (snapshot: Snapshot, sim: Sim) => {
      const state = renderStateRef.current;
      state.tick = snapshot.tick;
      state.tMs = snapshot.tMs;

      const myState = snapshot.players[sim.myId];
      if (myState) {
        state.me.x = myState.pos.x;
        state.me.y = myState.pos.y;
        state.me.hp = myState.hp;
        state.me.dir = myState.dir;
      }

      const oppState = snapshot.players[sim.oppId];
      if (oppState) {
        let oppTarget = state.opp;
        if (!oppTarget) {
          oppTarget = { x: 0, y: 0, hp: 100, dir: 1 };
          state.opp = oppTarget;
        }
        oppTarget.x = oppState.pos.x;
        oppTarget.y = oppState.pos.y;
        oppTarget.hp = oppState.hp;
        oppTarget.dir = oppState.dir;
      } else {
        state.opp = undefined;
      }

      if (simOverlayRef.current) {
        const meState = state.me;
        const opp = state.opp;
        const parts = [
          `SIM t=${state.tick}`,
          `me(${meState.x.toFixed(1)},${meState.y.toFixed(1)}) hp=${meState.hp}`,
        ];
        if (opp) {
          parts.push(`opp(${opp.x.toFixed(1)},${opp.y.toFixed(1)}) hp=${opp.hp}`);
        }
        simOverlayRef.current.textContent = parts.join(" | ");
      }
      checkGameReady(snapshot.tick);
    },
    [checkGameReady],
  );

  const spawn = useMemo(() => {
    const ids = presence.map((p) => p.playerId);
    if (!ids.includes(statePlayerId)) {
      ids.push(statePlayerId);
    }
    ids.sort();
    const index = ids.indexOf(statePlayerId);
    if (index <= 0) return SPAWN_A;
    if (index === 1) return SPAWN_B;
    return index % 2 === 0 ? SPAWN_A : SPAWN_B;
  }, [presence, statePlayerId]);

  useEffect(() => {
    if (!stateRef || !spawn || !networkId) {
      return;
    }
    const key = `${arenaId}:${statePlayerId}:${me.codename}:${spawn.x}:${spawn.y}`;
    if (initKeyRef.current === key) {
      return;
    }
    let aborted = false;
    setArenaInitError(null);
    (async () => {
      try {
        await initArenaPlayerState(
          arenaId,
          { id: statePlayerId, codename: me.codename },
          spawn,
        );
        if (aborted) return;
        initKeyRef.current = key;
        console.info("[BOOT] stateReady=true");
      } catch (err) {
        console.warn("[ArenaCanvas] initArenaPlayerState failed", err);
        if (!aborted) {
          initKeyRef.current = null;
          setArenaInitError(err instanceof Error ? err.message : String(err));
        }
      }
    })().catch((err) => console.error(err));

    return () => {
      aborted = true;
      if (initKeyRef.current === key) {
        initKeyRef.current = null;
      }
    };
  }, [arenaId, me.codename, networkId, spawn, statePlayerId, stateRef]);

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
    const sceneData = { arenaId, me: { id: statePlayerId, codename: me.codename }, spawn };
    game.scene.add("Arena", ArenaScene, true, sceneData);
    setCanvasReady(true);
    console.info("[BOOT] canvasReady=true");
    checkGameReady(renderStateRef.current.tick);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      setCanvasReady(false);
      gameReadyRef.current = false;
      setGameReady(false);
    };
  }, [arenaId, checkGameReady, me.codename, spawn, statePlayerId, stateReady]);

  useEffect(() => {
    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
      gameReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    stateReadyRef.current = stateReady;
    if (!stateReady) {
      gameReadyRef.current = false;
      setGameReady(false);
    } else {
      checkGameReady(renderStateRef.current.tick);
    }
  }, [checkGameReady, stateReady]);

  useEffect(() => {
    if (!stateReady || !canvasReady || !networkId) {
      simRef.current = null;
      pendingActionsRef.current.length = 0;
      remoteSourceRef.current = null;
      lastFrameRef.current = null;
      return;
    }

    const seed = hashSeed(arenaId);
    const sim = initSim({ seed, myPlayerId: statePlayerId, opponentId: SIM_OPPONENT_ID });
    simRef.current = sim;
    pendingActionsRef.current.length = 0;
    remoteSourceRef.current = null;
    localSeqRef.current = 0;
    lastFrameRef.current = null;
    const snapshot = getSnapshot(sim);
    updateRenderState(snapshot, sim);
    console.info(`[SIM] init ok seed=${seed} myId=${statePlayerId} oppId=${SIM_OPPONENT_ID}`);

    return () => {
      simRef.current = null;
      pendingActionsRef.current.length = 0;
      remoteSourceRef.current = null;
      lastFrameRef.current = null;
    };
  }, [arenaId, canvasReady, networkId, statePlayerId, stateReady, updateRenderState]);

  useEffect(() => {
    if (!stateReady || !canvasReady || !networkId) {
      setBusReady(false);
      disposeActionBus();
      return;
    }

    let cancelled = false;
    initActionBus({
      arenaId,
      playerId: statePlayerId,
      onRemoteActions: (actions) => {
        if (cancelled) return;
        const queue = pendingActionsRef.current;
        actions.forEach((action) => {
          if (!remoteSourceRef.current) {
            remoteSourceRef.current = action.playerId;
          }
          if (remoteSourceRef.current !== action.playerId) {
            return;
          }
          queue.push({
            arenaId: action.arenaId,
            playerId: SIM_OPPONENT_ID,
            seq: action.seq,
            input: action.input,
            clientTs: action.clientTs,
            createdAt: action.createdAt,
          });
        });
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
  }, [arenaId, canvasReady, networkId, statePlayerId, stateReady]);

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
      const payload: InputFlags = {
        left: keyState.left,
        right: keyState.right,
        jump: keyState.jump,
        attack: keyState.attack,
      };
      queueLocalAction(payload);
      publishInput(payload);
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
  }, [busReady, queueLocalAction]);

  useEffect(() => {
    if (!busReady || !simRef.current) {
      if (rafStartedRef.current && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        rafStartedRef.current = false;
        console.info("[LOOP] raf stop");
      }
      lastFrameRef.current = null;
      return;
    }

    if (rafStartedRef.current) {
      return;
    }

    rafStartedRef.current = true;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    loopLogRef.current.lastLog = now;
    loopLogRef.current.lastTick = renderStateRef.current.tick;
    console.info("[LOOP] raf start");
    let active = true;

    const step = (timestamp: number) => {
      const sim = simRef.current;
      if (!active || !sim) {
        return;
      }
      const last = lastFrameRef.current ?? timestamp;
      let dt = timestamp - last;
      if (!Number.isFinite(dt) || dt < 0) {
        dt = 0;
      }
      if (dt > MAX_FRAME_DT) {
        dt = MAX_FRAME_DT;
      }
      lastFrameRef.current = timestamp;

      const queue = pendingActionsRef.current;
      let actions: ActionDoc[] = [];
      if (queue.length > 0) {
        actions = queue.slice();
        queue.length = 0;
      }

      applyActions(sim, actions, dt);
      const snapshot = getSnapshot(sim);
      updateRenderState(snapshot, sim);

      const logNow = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = logNow - loopLogRef.current.lastLog;
      const stepsApplied = Math.max(0, snapshot.tick - loopLogRef.current.lastTick);
      if (elapsed >= 500) {
        console.info(
          `[LOOP] tick=${snapshot.tick} stepsApplied=${stepsApplied} dtMs=${dt.toFixed(2)}`,
        );
        loopLogRef.current.lastLog = logNow;
      }
      loopLogRef.current.lastTick = snapshot.tick;

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (rafStartedRef.current) {
        rafStartedRef.current = false;
        console.info("[LOOP] raf stop");
      }
      lastFrameRef.current = null;
    };
  }, [busReady, updateRenderState]);

  const overlayBaseStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    padding: "0 16px",
    textAlign: "center",
  };

  let overlayContent: React.ReactNode = null;
  if (arenaInitError) {
    overlayContent = (
      <div
        style={{
          ...overlayBaseStyle,
          color: "#fca5a5",
          background: "rgba(239, 68, 68, 0.08)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
        }}
      >
        Failed to initialize arena: {String(arenaInitError)}
      </div>
    );
  } else if (!stateReady) {
    overlayContent = (
      <div
        style={{
          ...overlayBaseStyle,
          color: "#9ca3af",
        }}
      >
        {`Initializing arena… (waiting for /arenas/${arenaId}/state)`}
      </div>
    );
  } else if (!gameReady) {
    overlayContent = (
      <div
        style={{
          ...overlayBaseStyle,
          color: "#9ca3af",
        }}
      >
        Initializing arena...
      </div>
    );
  }

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
        <div
          ref={simOverlayRef}
          style={{
            position: "absolute",
            top: 36,
            left: 8,
            background: "rgba(59, 130, 246, 0.12)",
            border: "1px solid rgba(59, 130, 246, 0.35)",
            color: "#93c5fd",
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 6,
            pointerEvents: "none",
            minWidth: 180,
          }}
        />
        {overlayContent}
      </div>
    </div>
  );
};
