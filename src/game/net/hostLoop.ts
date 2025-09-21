import {
  fetchArenaInputs,
  writeArenaState,
  recordLeaderboardWin,
  type ArenaInputSnapshot,
  type ArenaStateWrite,
} from "../../firebase";
import { applyActions, getSnapshot, initSim } from "../../sim/reducer";
import type { ActionDoc, Sim } from "../../sim/types";

export interface HostLoopOptions {
  arenaId: string;
  hostId: string;
  tickRateHz?: number;
  seed?: number;
  log?: typeof console;
}

export interface HostLoopController {
  stop(): void;
}

const DEFAULT_TICK_RATE = 11;
const MAX_DT_MS = 250;
const LEADERBOARD_DEBUG = import.meta.env?.VITE_DEBUG_FIREBASE === "true" || import.meta.env?.DEV;
const LIVE_INPUT_WINDOW_MS = 200;

function buildActions(
  arenaId: string,
  participants: ArenaInputSnapshot[],
  seqByPlayer: Map<string, number>,
  timestamp: number,
): ActionDoc[] {
  return participants.map((participant) => {
    const nextSeq = (seqByPlayer.get(participant.playerId) ?? 0) + 1;
    seqByPlayer.set(participant.playerId, nextSeq);
    return {
      arenaId,
      playerId: participant.playerId,
      seq: nextSeq,
      input: {
        left: !!participant.left,
        right: !!participant.right,
        jump: !!participant.jump,
        attack: !!participant.attack,
      },
      clientTs: timestamp,
    };
  });
}

function makeStateWrite(
  participants: ArenaInputSnapshot[],
  snapshot: ReturnType<typeof getSnapshot>,
): ArenaStateWrite {
  const inputsById = new Map(participants.map((p) => [p.playerId, p]));
  const players: ArenaStateWrite["players"] = {};
  for (const [playerId, state] of Object.entries(snapshot.players)) {
    const input = inputsById.get(playerId);
    players[playerId] = {
      codename: input?.codename,
      x: state.pos.x,
      y: state.pos.y,
      vx: state.vel.x,
      vy: state.vel.y,
      facing: state.dir === -1 ? "L" : "R",
      hp: state.hp,
      anim: state.attackActiveUntil > snapshot.tMs ? "attack" : undefined,
    };
  }
  return {
    tick: snapshot.tick,
    tMs: snapshot.tMs,
    players,
  };
}

function selectParticipants(
  inputs: ArenaInputSnapshot[],
  hostId: string,
): ArenaInputSnapshot[] {
  if (!inputs.length) {
    return [];
  }
  const byId = new Map(inputs.map((entry) => [entry.playerId, entry]));
  const sortedIds = [...byId.keys()].sort();
  if (byId.has(hostId)) {
    const index = sortedIds.indexOf(hostId);
    if (index > 0) {
      sortedIds.splice(index, 1);
      sortedIds.unshift(hostId);
    }
  }
  const selected = sortedIds.slice(0, 2).map((id) => byId.get(id)).filter(Boolean) as ArenaInputSnapshot[];
  return selected.length === 2 ? selected : [];
}

export function startHostLoop(options: HostLoopOptions): HostLoopController {
  const tickRate = options.tickRateHz ?? DEFAULT_TICK_RATE;
  const intervalMs = Math.max(1, Math.round(1000 / tickRate));
  const logger = options.log ?? console;

  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let sim: Sim | null = null;
  let playerOrder: string[] = [];
  let lastStepAt = Date.now();
  const seqByPlayer = new Map<string, number>();
  const previousHp = new Map<string, number>();

  const resetSim = (participants: ArenaInputSnapshot[]) => {
    if (participants.length < 2) {
      sim = null;
      playerOrder = [];
      seqByPlayer.clear();
      previousHp.clear();
      return;
    }
    const [a, b] = participants;
    sim = initSim({
      seed: options.seed ?? 1,
      myPlayerId: a.playerId,
      opponentId: b.playerId,
    });
    playerOrder = [a.playerId, b.playerId];
    seqByPlayer.clear();
    previousHp.clear();
    lastStepAt = Date.now();
    logger.info?.("[hostLoop] sim reset", { arenaId: options.arenaId, players: playerOrder });
  };

  const detectKoTransition = (
    snapshot: ReturnType<typeof getSnapshot>,
    participants: ArenaInputSnapshot[],
  ) => {
    if (participants.length < 2) {
      previousHp.clear();
      return;
    }

    const players = snapshot.players ?? {};
    for (const [playerId, state] of Object.entries(players)) {
      const hp = typeof state.hp === "number" ? state.hp : 100;
      const prev = previousHp.get(playerId);

      if (typeof prev === "number" && prev > 0 && hp <= 0) {
        const winner = participants.find((p) => p.playerId !== playerId);
        if (winner) {
          void recordLeaderboardWin({ playerId: winner.playerId, codename: winner.codename }).catch((error) => {
            if (LEADERBOARD_DEBUG) {
              logger.error?.("[hostLoop] recordLeaderboardWin failed", error);
            }
          });
        }
      }

      previousHp.set(playerId, hp);
    }

    for (const key of [...previousHp.keys()]) {
      if (!(key in players)) {
        previousHp.delete(key);
      }
    }
  };

  const step = async () => {
    if (stopped || busy) {
      return;
    }
    busy = true;
    try {
      const inputs = await fetchArenaInputs(options.arenaId);
      const fetchNowMs = Date.now();
      const liveInputs = inputs.filter((entry) => {
        const updatedAtMs = entry.updatedAt ? Date.parse(entry.updatedAt) : NaN;
        if (!Number.isFinite(updatedAtMs)) {
          return false;
        }
        return fetchNowMs - updatedAtMs <= LIVE_INPUT_WINDOW_MS;
      });
      const liveIds = new Set(liveInputs.map((entry) => entry.playerId));
      const staleEntries = inputs
        .filter((entry) => !liveIds.has(entry.playerId))
        .map((entry) => {
          const updatedAtMs = entry.updatedAt ? Date.parse(entry.updatedAt) : NaN;
          return {
            playerId: entry.playerId,
            updatedAt: entry.updatedAt,
            ageMs: Number.isFinite(updatedAtMs) ? fetchNowMs - updatedAtMs : null,
          };
        });

      logger.debug?.("[hostLoop] live input filter", {
        arenaId: options.arenaId,
        total: inputs.length,
        livePlayerIds: liveInputs.map((entry) => entry.playerId),
        stale: staleEntries,
      });

      const participants = selectParticipants(liveInputs, options.hostId);

      logger.debug?.("[hostLoop] participant selection", {
        arenaId: options.arenaId,
        candidates: liveInputs.map((entry) => entry.playerId),
        selected: participants.map((entry) => entry.playerId),
      });
      if (!participants.length) {
        sim = null;
        playerOrder = [];
        seqByPlayer.clear();
        return;
      }

      const currentOrder = participants.map((p) => p.playerId);
      if (currentOrder.join("|") !== playerOrder.join("|")) {
        resetSim(participants);
      }

      if (!sim) {
        return;
      }

      const now = Date.now();
      const dtMs = Math.min(Math.max(now - lastStepAt, 0), MAX_DT_MS);
      lastStepAt = now;

      const actions = buildActions(options.arenaId, participants, seqByPlayer, now);
      applyActions(sim, actions, dtMs);
      const snapshot = getSnapshot(sim);
      detectKoTransition(snapshot, participants);
      const stateWrite = makeStateWrite(participants, snapshot);
      await writeArenaState(options.arenaId, stateWrite);
    } catch (error) {
      logger.error?.("[hostLoop] step error", error);
    } finally {
      busy = false;
    }
  };

  timer = setInterval(() => {
    void step();
  }, intervalMs);

  logger.info?.("[hostLoop] started", { arenaId: options.arenaId, tickRate });

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      sim = null;
      playerOrder = [];
      seqByPlayer.clear();
      logger.info?.("[hostLoop] stopped", { arenaId: options.arenaId });
    },
  };
}
