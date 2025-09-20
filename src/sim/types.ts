export type PlayerId = string;

export type InputFlags = {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
};

export type ActionDoc = {
  arenaId: string;
  playerId: PlayerId;
  seq: number;
  input: InputFlags;
  clientTs: number;
  createdAt?: unknown;
};

export type Vec2 = { x: number; y: number };

export type PlayerState = {
  pos: Vec2;
  vel: Vec2;
  dir: -1 | 1;
  hp: number;
  attackActiveUntil: number;
  canAttackAt: number;
  grounded: boolean;
};

export type HistoryEntry = {
  tick: number;
  tMs: number;
  players: Record<PlayerId, PlayerState>;
  inputs: Record<PlayerId, InputFlags>;
  prevJump: Record<PlayerId, boolean>;
  prevAttack: Record<PlayerId, boolean>;
  attackSeq: Record<PlayerId, number>;
  currentAttackId: Record<PlayerId, number | null>;
  attackHitToken: Record<PlayerId, number | null>;
  accumulator: number;
  lastAppliedSeq: Record<PlayerId, number>;
};

export type SimDebug = {
  lastAppliedSeq: Record<PlayerId, number>;
  lastRewindSkipped?: boolean;
};

export type Snapshot = {
  tick: number;
  tMs: number;
  players: Record<PlayerId, PlayerState>;
};

export type Sim = {
  myId: PlayerId;
  oppId: PlayerId;
  seed: number;
  snap: Snapshot;
  _history?: (HistoryEntry | undefined)[];
  _historyHead?: number;
  _historySize?: number;
  _lastAppliedSeq?: Record<PlayerId, number>;
  _dbg?: SimDebug;
};
