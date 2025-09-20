import type {
  ActionDoc,
  InputFlags,
  PlayerId,
  PlayerState,
  Sim,
  Snapshot,
  Vec2,
} from './types.js';

const FIXED_DT_MS = 16.6667;
const GRAVITY = 900;
const ACCEL = 1200;
const FRICTION_G = 1400;
const FRICTION_A = 200;
const JUMP = 420;
const ATTACK_WINDOW_MS = 120;
const ATTACK_COOLDOWN_MS = 250;
const DAMAGE = 10;
const ARENA_MIN_X = 0;
const ARENA_MAX_X = 960;
const FLOOR_Y = 0;
const TIME_PRECISION = 1e-4;

const PLAYER_SPAWN_POSITIONS: Record<'left' | 'right', Vec2> = {
  left: { x: 200, y: 0 },
  right: { x: 760, y: 0 },
};

const PLAYER_INITIAL_HP = 100;

interface InternalSim extends Sim {
  _inputs: Record<PlayerId, InputFlags>;
  _prevJump: Record<PlayerId, boolean>;
  _prevAttack: Record<PlayerId, boolean>;
  _attackSeq: Record<PlayerId, number>;
  _currentAttackId: Record<PlayerId, number | null>;
  _attackHitToken: Record<PlayerId, number | null>;
  _accumulator: number;
}

const EPSILON = 1e-6;

function clampTime(value: number): number {
  return Math.round(value / TIME_PRECISION) * TIME_PRECISION;
}

function clonePlayerState(state: PlayerState): PlayerState {
  return {
    pos: { ...state.pos },
    vel: { ...state.vel },
    dir: state.dir,
    hp: state.hp,
    attackActiveUntil: state.attackActiveUntil,
    canAttackAt: state.canAttackAt,
    grounded: state.grounded,
  };
}

function ensureInternal(sim: Sim): InternalSim {
  const internal = sim as InternalSim;
  if (!internal._inputs) {
    internal._inputs = {};
  }
  if (!internal._prevJump) {
    internal._prevJump = {};
  }
  if (!internal._prevAttack) {
    internal._prevAttack = {};
  }
  if (!internal._attackSeq) {
    internal._attackSeq = {};
  }
  if (!internal._currentAttackId) {
    internal._currentAttackId = {};
  }
  if (!internal._attackHitToken) {
    internal._attackHitToken = {};
  }
  if (typeof internal._accumulator !== 'number') {
    internal._accumulator = 0;
  }
  return internal;
}

function createPlayerState(position: Vec2, dir: -1 | 1): PlayerState {
  return {
    pos: { ...position },
    vel: { x: 0, y: 0 },
    dir,
    hp: PLAYER_INITIAL_HP,
    attackActiveUntil: 0,
    canAttackAt: 0,
    grounded: true,
  };
}

function applyFriction(state: PlayerState, dtSec: number): void {
  const friction = (state.grounded ? FRICTION_G : FRICTION_A) * dtSec;
  if (state.vel.x > 0) {
    state.vel.x = Math.max(0, state.vel.x - friction);
  } else if (state.vel.x < 0) {
    state.vel.x = Math.min(0, state.vel.x + friction);
  }
}

function updateAttackState(
  internal: InternalSim,
  playerId: PlayerId,
  state: PlayerState,
  attackPressed: boolean,
  prevAttack: boolean,
  timeMs: number,
): void {
  if (attackPressed && !prevAttack && timeMs >= state.canAttackAt) {
    const nextId = (internal._attackSeq[playerId] ?? 0) + 1;
    internal._attackSeq[playerId] = nextId;
    internal._currentAttackId[playerId] = nextId;
    internal._attackHitToken[playerId] = null;
    state.attackActiveUntil = clampTime(timeMs + ATTACK_WINDOW_MS);
    state.canAttackAt = clampTime(timeMs + ATTACK_COOLDOWN_MS);
  } else if (timeMs >= state.attackActiveUntil) {
    internal._currentAttackId[playerId] = null;
  }
}

function handleAttacks(internal: InternalSim, timeMs: number): void {
  const ids = Object.keys(internal.snap.players);
  for (const attackerId of ids) {
    const attackId = internal._currentAttackId[attackerId];
    const attacker = internal.snap.players[attackerId];
    if (!attackId || timeMs >= attacker.attackActiveUntil) {
      continue;
    }
    for (const defenderId of ids) {
      if (defenderId === attackerId) {
        continue;
      }
      if (internal._attackHitToken[attackerId] === attackId) {
        break;
      }
      const defender = internal.snap.players[defenderId];
      const dx = defender.pos.x - attacker.pos.x;
      const dy = defender.pos.y - attacker.pos.y;
      if (Math.abs(dx) > 40 || Math.abs(dy) > 24) {
        continue;
      }
      if ((attacker.dir === 1 && dx < 0) || (attacker.dir === -1 && dx > 0)) {
        continue;
      }
      defender.hp = Math.max(0, defender.hp - DAMAGE);
      internal._attackHitToken[attackerId] = attackId;
      break;
    }
  }
}

function stepSim(internal: InternalSim): void {
  const dtMs = FIXED_DT_MS;
  const dtSec = dtMs / 1000;
  const timeStart = internal.snap.tMs;
  const playerIds: PlayerId[] = [internal.myId, internal.oppId];

  for (const playerId of playerIds) {
    const state = internal.snap.players[playerId];
    if (!state) {
      continue;
    }
    const input = internal._inputs[playerId] ?? {};
    const left = !!input.left;
    const right = !!input.right;
    const jumpPressed = !!input.jump;
    const attackPressed = !!input.attack;
    const prevJump = internal._prevJump[playerId] ?? false;
    const prevAttack = internal._prevAttack[playerId] ?? false;

    updateAttackState(internal, playerId, state, attackPressed, prevAttack, timeStart);

    if (left && !right) {
      state.vel.x -= ACCEL * dtSec;
      state.dir = -1;
    } else if (right && !left) {
      state.vel.x += ACCEL * dtSec;
      state.dir = 1;
    } else {
      applyFriction(state, dtSec);
    }

    if (jumpPressed && !prevJump && state.grounded) {
      state.vel.y = JUMP;
      state.grounded = false;
    }

    state.vel.y -= GRAVITY * dtSec;

    state.pos.x += state.vel.x * dtSec;
    state.pos.y += state.vel.y * dtSec;

    if (state.pos.x < ARENA_MIN_X) {
      state.pos.x = ARENA_MIN_X;
      if (state.vel.x < 0) {
        state.vel.x = 0;
      }
    } else if (state.pos.x > ARENA_MAX_X) {
      state.pos.x = ARENA_MAX_X;
      if (state.vel.x > 0) {
        state.vel.x = 0;
      }
    }

    if (state.pos.y <= FLOOR_Y) {
      state.pos.y = FLOOR_Y;
      if (state.vel.y < 0) {
        state.vel.y = 0;
      }
      state.grounded = true;
    } else {
      state.grounded = false;
    }

    internal._prevJump[playerId] = jumpPressed;
    internal._prevAttack[playerId] = attackPressed;
  }

  handleAttacks(internal, timeStart);

  internal.snap.tick += 1;
  internal.snap.tMs = clampTime(internal.snap.tick * FIXED_DT_MS);
}

export function initSim(params: { seed: number; myPlayerId: string; opponentId: string }): Sim {
  const leftId = params.myPlayerId;
  const rightId = params.opponentId;
  const players: Record<PlayerId, PlayerState> = {
    [leftId]: createPlayerState(PLAYER_SPAWN_POSITIONS.left, 1),
    [rightId]: createPlayerState(PLAYER_SPAWN_POSITIONS.right, -1),
  };

  const sim: Sim = {
    myId: leftId,
    oppId: rightId,
    seed: params.seed,
    snap: {
      tick: 0,
      tMs: 0,
      players,
    },
  };

  const internal = ensureInternal(sim);
  internal._inputs[leftId] = {};
  internal._inputs[rightId] = {};
  internal._prevJump[leftId] = false;
  internal._prevJump[rightId] = false;
  internal._prevAttack[leftId] = false;
  internal._prevAttack[rightId] = false;
  internal._attackSeq[leftId] = 0;
  internal._attackSeq[rightId] = 0;
  internal._currentAttackId[leftId] = null;
  internal._currentAttackId[rightId] = null;
  internal._attackHitToken[leftId] = null;
  internal._attackHitToken[rightId] = null;
  internal._accumulator = 0;

  return sim;
}

export function applyActions(sim: Sim, actions: ActionDoc[], dtMs: number): void {
  const internal = ensureInternal(sim);
  const relevantActions = actions.filter((action) => action.playerId in internal.snap.players);
  relevantActions.sort((a, b) => a.seq - b.seq);

  for (const action of relevantActions) {
    const previous = internal._inputs[action.playerId] ?? {};
    internal._inputs[action.playerId] = { ...previous, ...action.input };
  }

  internal._accumulator += dtMs;

  while (internal._accumulator + EPSILON >= FIXED_DT_MS) {
    internal._accumulator -= FIXED_DT_MS;
    stepSim(internal);
  }
}

export function getSnapshot(sim: Sim): Snapshot {
  const players: Record<PlayerId, PlayerState> = {};
  for (const [playerId, state] of Object.entries(sim.snap.players)) {
    players[playerId as PlayerId] = clonePlayerState(state);
  }
  return {
    tick: sim.snap.tick,
    tMs: sim.snap.tMs,
    players,
  };
}

export function rewindTo(_sim: Sim, _tick: number): void {
  // no-op placeholder for future rollback support
}

