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
};
