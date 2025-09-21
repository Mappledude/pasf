import { applyActions, getSnapshot, initSim, resetPlayersToSpawn, FIXED_STEP_MS, PLAYER_INITIAL_HP } from './reducer.js';
import type { ActionDoc, PlayerId, Sim, Vec2 } from './types.js';

export type ArenaPhase = 'lobby' | 'play' | 'ko' | 'reset';

export type ArenaLastEvent =
  | { type: 'phase'; phase: ArenaPhase; tick: number }
  | { type: 'ko'; tick: number; loserId: PlayerId; winnerId?: PlayerId; stocks: Record<PlayerId, number> };

export interface ArenaPlayerFrame {
  pos: Vec2;
  vel: Vec2;
  dir: -1 | 1;
  hp: number;
  attackActiveUntil: number;
  canAttackAt: number;
  grounded: boolean;
  stocks: number;
  codename?: string;
}

export interface ArenaHostSnapshot {
  tick: number;
  phase: ArenaPhase;
  players: Record<PlayerId, ArenaPlayerFrame>;
  lastEvent?: ArenaLastEvent;
}

export interface HostLoopOptions {
  myPlayerId: PlayerId;
  opponentId: PlayerId;
  seed?: number;
  startingStocks?: number;
  koDurationMs?: number;
  resetDurationMs?: number;
  spawnOverrides?: Partial<Record<PlayerId, Vec2>>;
  metadata?: Partial<Record<PlayerId, { codename?: string }>>;
}

interface PlayerMeta {
  spawn: Vec2;
  dir: -1 | 1;
  codename?: string;
}

function cloneVec(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

export class ArenaHostLoop {
  private readonly sim: Sim;
  private readonly koDurationTicks: number;
  private readonly resetDurationTicks: number;
  private readonly meta: Record<PlayerId, PlayerMeta> = {};
  private readonly stocks: Record<PlayerId, number> = {};
  private phase: ArenaPhase = 'lobby';
  private lastEvent?: ArenaLastEvent;
  private phaseTimeoutTick: number | null = null;
  private prevHp: Record<PlayerId, number> = {};

  constructor(options: HostLoopOptions) {
    const seed = typeof options.seed === 'number' ? options.seed : 0;
    this.sim = initSim({ seed, myPlayerId: options.myPlayerId, opponentId: options.opponentId });

    this.koDurationTicks = Math.max(1, Math.round((options.koDurationMs ?? 900) / FIXED_STEP_MS));
    this.resetDurationTicks = Math.max(1, Math.round((options.resetDurationMs ?? 600) / FIXED_STEP_MS));

    const startingStocks = Math.max(0, Math.floor(options.startingStocks ?? 3));
    this.stocks[options.myPlayerId] = startingStocks;
    this.stocks[options.opponentId] = startingStocks;

    this.hydrateMeta(options.spawnOverrides, options.metadata);
    this.prevHp = this.captureHp();
  }

  step(actions: ActionDoc[], dtMs: number): ArenaHostSnapshot {
    if (this.phase === 'lobby') {
      this.setPhase('play');
    }

    const actionable = this.phase === 'play' ? actions : [];
    applyActions(this.sim, actionable, dtMs);

    if (this.phase === 'play') {
      const result = this.detectKo();
      if (result) {
        this.handleKo(result.loserId, result.winnerId);
      }
    }

    this.advancePhase();

    return this.buildSnapshot();
  }

  getSnapshot(): ArenaHostSnapshot {
    return this.buildSnapshot();
  }

  private hydrateMeta(
    spawnOverrides?: Partial<Record<PlayerId, Vec2>>,
    metadata?: Partial<Record<PlayerId, { codename?: string }>>,
  ): void {
    const snap = getSnapshot(this.sim);
    for (const [playerId, state] of Object.entries(snap.players)) {
      const id = playerId as PlayerId;
      const override = spawnOverrides?.[id];
      const spawn = override ? cloneVec(override) : cloneVec(state.pos);
      const meta: PlayerMeta = {
        spawn,
        dir: state.dir,
        codename: metadata?.[id]?.codename,
      };
      this.meta[id] = meta;
      if (override) {
        this.applySpawnOverride(id, override, state.dir);
      }
    }
    this.prevHp = this.captureHp();
  }

  private applySpawnOverride(playerId: PlayerId, spawn: Vec2, dir: -1 | 1): void {
    const state = this.sim.snap.players[playerId];
    if (!state) {
      return;
    }
    state.pos.x = spawn.x;
    state.pos.y = spawn.y;
    state.vel.x = 0;
    state.vel.y = 0;
    state.dir = dir;
    state.grounded = true;
    state.attackActiveUntil = 0;
    state.canAttackAt = 0;
  }

  private captureHp(): Record<PlayerId, number> {
    const hp: Record<PlayerId, number> = {};
    for (const [playerId, state] of Object.entries(this.sim.snap.players)) {
      hp[playerId as PlayerId] = state.hp;
    }
    return hp;
  }

  private setPhase(next: ArenaPhase): void {
    this.phase = next;
    this.lastEvent = { type: 'phase', phase: next, tick: this.sim.snap.tick };
  }

  private detectKo(): { loserId: PlayerId; winnerId?: PlayerId } | null {
    for (const [playerId, state] of Object.entries(this.sim.snap.players)) {
      const id = playerId as PlayerId;
      const previous = this.prevHp[id] ?? PLAYER_INITIAL_HP;
      if (previous > 0 && state.hp <= 0) {
        const winner = Object.keys(this.sim.snap.players).find((pid) => pid !== id) as PlayerId | undefined;
        this.prevHp = this.captureHp();
        return { loserId: id, winnerId: winner };
      }
    }
    this.prevHp = this.captureHp();
    return null;
  }

  private handleKo(loserId: PlayerId, winnerId?: PlayerId): void {
    const remaining = Math.max(0, (this.stocks[loserId] ?? 0) - 1);
    this.stocks[loserId] = remaining;

    const loserState = this.sim.snap.players[loserId];
    if (loserState) {
      loserState.vel.x = 0;
      loserState.vel.y = 0;
    }

    this.phase = 'ko';
    this.phaseTimeoutTick = this.sim.snap.tick + this.koDurationTicks;
    this.lastEvent = {
      type: 'ko',
      tick: this.sim.snap.tick,
      loserId,
      winnerId,
      stocks: { ...this.stocks },
    };
  }

  private advancePhase(): void {
    if (this.phaseTimeoutTick === null) {
      return;
    }
    if (this.sim.snap.tick < this.phaseTimeoutTick) {
      return;
    }

    if (this.phase === 'ko') {
      this.phase = 'reset';
      this.phaseTimeoutTick = this.sim.snap.tick + this.resetDurationTicks;
      resetPlayersToSpawn(this.sim);
      this.applyStoredSpawns();
      this.prevHp = this.captureHp();
    } else if (this.phase === 'reset') {
      this.phase = 'play';
      this.phaseTimeoutTick = null;
      this.lastEvent = { type: 'phase', phase: 'play', tick: this.sim.snap.tick };
    } else {
      this.phaseTimeoutTick = null;
    }
  }

  private applyStoredSpawns(): void {
    for (const [playerId, meta] of Object.entries(this.meta)) {
      const id = playerId as PlayerId;
      const state = this.sim.snap.players[id];
      if (!state) {
        continue;
      }
      state.pos.x = meta.spawn.x;
      state.pos.y = meta.spawn.y;
      state.vel.x = 0;
      state.vel.y = 0;
      state.dir = meta.dir;
      state.attackActiveUntil = 0;
      state.canAttackAt = 0;
      state.grounded = true;
    }
  }

  private buildSnapshot(): ArenaHostSnapshot {
    const snap = getSnapshot(this.sim);
    const players: Record<PlayerId, ArenaPlayerFrame> = {};
    for (const [playerId, state] of Object.entries(snap.players)) {
      const id = playerId as PlayerId;
      const meta = this.meta[id];
      players[id] = {
        pos: cloneVec(state.pos),
        vel: cloneVec(state.vel),
        dir: state.dir,
        hp: state.hp,
        attackActiveUntil: state.attackActiveUntil,
        canAttackAt: state.canAttackAt,
        grounded: state.grounded,
        stocks: this.stocks[id] ?? 0,
        codename: meta?.codename,
      };
    }

    const snapshot: ArenaHostSnapshot = {
      tick: snap.tick,
      phase: this.phase,
      players,
    };
    if (this.lastEvent) {
      snapshot.lastEvent = this.lastEvent;
    }
    return snapshot;
  }
}

export function createHostLoop(options: HostLoopOptions): ArenaHostLoop {
  return new ArenaHostLoop(options);
}
