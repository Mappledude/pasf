export type InputIntent = {
  left: boolean;
  right: boolean;
  up: boolean;
  jump: boolean;
  attack: boolean;
  ts: number;
  seq: number;
};

export type PlayerState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
};

export type Snapshot = {
  t: number;
  p1: PlayerState;
  p2: PlayerState;
  events?: string[];
  ts: number;
};

export type MatchStatus = "waiting" | "active" | "ended";

export type MatchDoc = {
  id: string;
  arenaId: string;
  players: { playerId: string; codename: string }[];
  status: MatchStatus;
  tick: number;
  createdAt: string;
  updatedAt?: string;
};
