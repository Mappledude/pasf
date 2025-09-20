import type {
  ActionDoc,
  HistoryEntry,
  InputFlags,
  PlayerId,
  PlayerState,
  Sim,
  Snapshot,
  Vec2,
} from './types.js';

const FIXED_DT_MS = 16.6667;
const HISTORY_MS = 3000;
const HISTORY_CAP = Math.ceil(HISTORY_MS / FIXED_DT_MS);
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
  _history: (HistoryEntry | undefined)[];
  _historyHead: number;
  _historySize: number;
  _lastAppliedSeq: Record<PlayerId, number>;
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
  if (!internal._history) {
    internal._history = new Array<HistoryEntry | undefined>(HISTORY_CAP);
  }
  if (typeof internal._historyHead !== 'number') {
    internal._historyHead = 0;
  }
  if (typeof internal._historySize !== 'number') {
    internal._historySize = 0;
  }
  if (!internal._lastAppliedSeq) {
    internal._lastAppliedSeq = {};
  }
  if (!internal._dbg) {
    internal._dbg = { lastAppliedSeq: {} };
  } else if (!internal._dbg.lastAppliedSeq) {
    internal._dbg.lastAppliedSeq = {};
  }
  return internal;
}

function cloneInputs(inputs: Record<PlayerId, InputFlags>): Record<PlayerId, InputFlags> {
  const copy: Record<PlayerId, InputFlags> = {};
  for (const [playerId, flags] of Object.entries(inputs)) {
    if (!flags) {
      continue;
    }
    copy[playerId as PlayerId] = { ...flags };
  }
  return copy;
}

function cloneBooleanRecord(record: Record<PlayerId, boolean>): Record<PlayerId, boolean> {
  const copy: Record<PlayerId, boolean> = {};
  for (const [playerId, value] of Object.entries(record)) {
    copy[playerId as PlayerId] = !!value;
  }
  return copy;
}

function cloneNumberRecord(record: Record<PlayerId, number>): Record<PlayerId, number> {
  const copy: Record<PlayerId, number> = {};
  for (const [playerId, value] of Object.entries(record)) {
    if (typeof value === 'number') {
      copy[playerId as PlayerId] = value;
    }
  }
  return copy;
}

function cloneNullableNumberRecord(
  record: Record<PlayerId, number | null>,
): Record<PlayerId, number | null> {
  const copy: Record<PlayerId, number | null> = {};
  for (const [playerId, value] of Object.entries(record)) {
    copy[playerId as PlayerId] = value ?? null;
  }
  return copy;
}

function clonePlayersRecord(
  players: Record<PlayerId, PlayerState>,
): Record<PlayerId, PlayerState> {
  const copy: Record<PlayerId, PlayerState> = {};
  for (const [playerId, state] of Object.entries(players)) {
    copy[playerId as PlayerId] = clonePlayerState(state);
  }
  return copy;
}

function recordHistorySnapshot(internal: InternalSim): void {
  const history = internal._history;
  if (!history || !history.length) {
    return;
  }
  const entry: HistoryEntry = {
    tick: internal.snap.tick,
    tMs: internal.snap.tMs,
    players: clonePlayersRecord(internal.snap.players),
    inputs: cloneInputs(internal._inputs),
    prevJump: cloneBooleanRecord(internal._prevJump),
    prevAttack: cloneBooleanRecord(internal._prevAttack),
    attackSeq: cloneNumberRecord(internal._attackSeq),
    currentAttackId: cloneNullableNumberRecord(internal._currentAttackId),
    attackHitToken: cloneNullableNumberRecord(internal._attackHitToken),
    accumulator: internal._accumulator,
    lastAppliedSeq: cloneNumberRecord(internal._lastAppliedSeq),
  };

  const head = internal._historyHead;
  const size = internal._historySize;
  let index: number;
  if (size < HISTORY_CAP) {
    index = (head + size) % HISTORY_CAP;
    internal._historySize = size + 1;
  } else {
    index = head;
    internal._historyHead = (head + 1) % HISTORY_CAP;
  }
  history[index] = entry;

  if (internal._dbg) {
    internal._dbg.lastAppliedSeq = cloneNumberRecord(internal._lastAppliedSeq);
  }
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
  internal._lastAppliedSeq[leftId] = 0;
  internal._lastAppliedSeq[rightId] = 0;
  if (internal._dbg) {
    internal._dbg.lastAppliedSeq[leftId] = 0;
    internal._dbg.lastAppliedSeq[rightId] = 0;
    internal._dbg.lastRewindSkipped = false;
  }
  recordHistorySnapshot(internal);

  return sim;
}

export function applyActions(sim: Sim, actions: ActionDoc[], dtMs: number): void {
  const internal = ensureInternal(sim);
  const relevantActions = actions.filter((action) => action.playerId in internal.snap.players);
  relevantActions.sort((a, b) => a.seq - b.seq);

  for (const action of relevantActions) {
    const previous = internal._inputs[action.playerId] ?? {};
    internal._inputs[action.playerId] = { ...previous, ...action.input };
    const current = internal._lastAppliedSeq[action.playerId] ?? 0;
    if (action.seq > current) {
      internal._lastAppliedSeq[action.playerId] = action.seq;
    }
  }

  if (internal._dbg) {
    internal._dbg.lastAppliedSeq = cloneNumberRecord(internal._lastAppliedSeq);
  }

  internal._accumulator += dtMs;

  while (internal._accumulator + EPSILON >= FIXED_DT_MS) {
    internal._accumulator -= FIXED_DT_MS;
    stepSim(internal);
    recordHistorySnapshot(internal);
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
  const internal = ensureInternal(_sim);
  const history = internal._history;
  const size = internal._historySize;
  const head = internal._historyHead;
  if (!history || size === 0) {
    if (internal._dbg) {
      internal._dbg.lastRewindSkipped = true;
    }
    return;
  }

  const oldest = history[head];
  if (!oldest || _tick < oldest.tick) {
    if (internal._dbg) {
      internal._dbg.lastRewindSkipped = true;
    }
    return;
  }

  let foundEntry: HistoryEntry | undefined;
  let offset = -1;
  for (let i = 0; i < size; i += 1) {
    const index = (head + i) % HISTORY_CAP;
    const entry = history[index];
    if (entry && entry.tick === _tick) {
      foundEntry = entry;
      offset = i;
      break;
    }
  }

  if (!foundEntry) {
    if (internal._dbg) {
      internal._dbg.lastRewindSkipped = true;
    }
    return;
  }

  internal.snap.tick = foundEntry.tick;
  internal.snap.tMs = foundEntry.tMs;
  internal.snap.players = clonePlayersRecord(foundEntry.players);
  internal._inputs = cloneInputs(foundEntry.inputs);
  internal._prevJump = cloneBooleanRecord(foundEntry.prevJump);
  internal._prevAttack = cloneBooleanRecord(foundEntry.prevAttack);
  internal._attackSeq = cloneNumberRecord(foundEntry.attackSeq);
  internal._currentAttackId = cloneNullableNumberRecord(foundEntry.currentAttackId);
  internal._attackHitToken = cloneNullableNumberRecord(foundEntry.attackHitToken);
  internal._accumulator = foundEntry.accumulator;
  internal._lastAppliedSeq = cloneNumberRecord(foundEntry.lastAppliedSeq);

  internal._historySize = offset + 1;

  if (internal._dbg) {
    internal._dbg.lastAppliedSeq = cloneNumberRecord(internal._lastAppliedSeq);
    internal._dbg.lastRewindSkipped = false;
  }
}

