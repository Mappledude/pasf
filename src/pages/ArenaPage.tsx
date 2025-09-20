import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { applyActions, getSnapshot, initSim } from "../sim/reducer";
import type { ActionDoc, InputFlags, Sim, Snapshot } from "../sim/types";

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
    },
    [],
  );

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
      simRef.current = null;
      pendingActionsRef.current.length = 0;
      remoteSourceRef.current = null;
      lastFrameRef.current = null;
      return;
    }

    const seed = hashSeed(arenaId);
    const sim = initSim({ seed, myPlayerId: networkId, opponentId: SIM_OPPONENT_ID });
    simRef.current = sim;
    pendingActionsRef.current.length = 0;
    remoteSourceRef.current = null;
    localSeqRef.current = 0;
    lastFrameRef.current = null;
    const snapshot = getSnapshot(sim);
    updateRenderState(snapshot, sim);

    return () => {
      simRef.current = null;
      pendingActionsRef.current.length = 0;
      remoteSourceRef.current = null;
      lastFrameRef.current = null;
    };
  }, [arenaId, networkId, stateReady, updateRenderState]);

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
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameRef.current = null;
      return;
    }

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

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameRef.current = null;
    };
  }, [busReady, updateRenderState]);

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
