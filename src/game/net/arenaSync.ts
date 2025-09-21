import {
  applyDamage,
  respawnPlayer,
  updateArenaPlayerState,
  watchArenaState,
  type ArenaPlayerState,
} from "../../firebase";
import { debugLog } from "../../net/debug";

export type ArenaPhase = "lobby" | "play" | "ko" | "reset";

export type ArenaLastEvent =
  | { type: "phase"; phase: ArenaPhase; tick: number }
  | { type: "ko"; tick: number; loserId: string; winnerId?: string; stocks: Record<string, number> };

export type ArenaPlayerFrame = {
  codename?: string;
  pos?: { x: number; y: number };
  vel?: { x: number; y: number };
  dir?: -1 | 1;
  hp?: number;
  stocks?: number;
  attackActiveUntil?: number;
  canAttackAt?: number;
  grounded?: boolean;
};

export type ArenaEntityFrame = {
  kind?: string;
  playerId?: string;
  codename?: string;
  pos?: { x?: number; y?: number };
  vel?: { x?: number; y?: number };
  dir?: -1 | 1;
  facing?: "L" | "R";
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  hp?: number;
  anim?: string;
  attackActiveUntil?: number;
  canAttackAt?: number;
  grounded?: boolean;
  presenceExpireAt?: unknown;
  presence?: { expireAt?: unknown };
  updatedAt?: unknown;
};

export type ArenaStateSnapshot = {
  tick?: number;
  tMs?: number;
  writerUid?: string;
  phase?: ArenaPhase;
  entities?: Record<string, ArenaEntityFrame | undefined>;
  players?: Record<string, ArenaPlayerFrame | undefined>;
  lastEvent?: ArenaLastEvent;
  writerUid?: string;
};

export interface ArenaHostOptions {
  arenaId: string;
  meId: string;
}

export interface ArenaPeerOptions {
  arenaId: string;
}

export interface ArenaHostService {
  /** Queue partial local state; debounced to HOST_WRITE_INTERVAL_MS. */
  setLocalState(partial: Partial<ArenaPlayerState>): void;
  /** Host-side damage application (authoritative). */
  applyDamage(targetPlayerId: string, amount: number): Promise<void>;
  /** Host-side respawn for the local player. */
  respawn(spawn: { x: number; y: number }): Promise<void>;
  /** Stop timers and release resources. */
  destroy(): void;
}

export interface ArenaPeerService {
  /** Subscribe to authoritative arena snapshots. */
  subscribe(cb: (state: ArenaStateSnapshot | undefined) => void): () => void;
  /** Release listeners/resources. */
  destroy(): void;
}

/** Target ~11 Hz authoritative writes from host. */
export const HOST_WRITE_INTERVAL_MS = 90;

const encoder = new TextEncoder();

type PlayerStatePartial = Partial<ArenaPlayerState>;
type Listener = (state: ArenaStateSnapshot | undefined) => void;

function shallowEqualState(a: PlayerStatePartial | null, b: PlayerStatePartial | null): boolean {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Host: batches local partial state and writes authoritative player node into
 * /arenas/{id}/state/current (via updateArenaPlayerState).
 */
export function createArenaHostService(options: ArenaHostOptions): ArenaHostService {
  const { arenaId, meId } = options;

  let destroyed = false;
  let queued: PlayerStatePartial | null = null;
  let lastSent: PlayerStatePartial | null = null;
  let tick = 0;

  const timer = setInterval(() => {
    if (destroyed || !queued) return;

    const next = queued;
    queued = null;

    if (shallowEqualState(lastSent, next)) return;

    lastSent = { ...next };
    tick += 1;

    // Lightweight telemetry on payload size
    const snapshot = { tick, players: { [meId]: next } };
    const bytes = encoder.encode(JSON.stringify(snapshot)).length;
    debugLog("[HOST] tick=%d wrote state (bytes=%d)", tick, bytes);

    updateArenaPlayerState(arenaId, meId, next, { tick }).catch((err) => {
      console.warn("[HOST] failed to write state", err);
    });
  }, HOST_WRITE_INTERVAL_MS);

  return {
    setLocalState(partial) {
      if (destroyed) return;
      queued = { ...(queued ?? {}), ...partial };
    },
    applyDamage(targetPlayerId, amount) {
      return applyDamage(arenaId, targetPlayerId, amount);
    },
    respawn(spawn) {
      return respawnPlayer(arenaId, meId, spawn);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInterval(timer);
      queued = null;
      lastSent = null;
    },
  };
}

/**
 * Peer: subscribes to authoritative arena snapshot document and fans out to listeners.
 */
export function createArenaPeerService(options: ArenaPeerOptions): ArenaPeerService {
  const { arenaId } = options;

  const listeners = new Set<Listener>();
  let unsubscribe: (() => void) | null = null;
  let destroyed = false;

  const ensureSubscription = () => {
    if (destroyed || unsubscribe) return;
    unsubscribe = watchArenaState(arenaId, (state) => {
      if (destroyed) return;
      const snapshot = mapAuthoritativeState(state);
      listeners.forEach((listener) => {
        try {
          listener(snapshot);
        } catch (err) {
          console.warn("[PEER] listener error", err);
        }
      });
    });
  };

  return {
    subscribe(cb) {
      if (destroyed) return () => undefined;
      listeners.add(cb);
      ensureSubscription();
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      listeners.clear();
    },
  };
}

function mapAuthoritativeState(state: unknown): ArenaStateSnapshot | undefined {
  if (!state || typeof state !== "object") {
    return undefined;
  }
  const raw = state as Record<string, unknown>;
  const entitiesRaw = raw.entities;
  const players: Record<string, ArenaPlayerFrame> = {};
  if (entitiesRaw && typeof entitiesRaw === "object") {
    for (const [uid, value] of Object.entries(entitiesRaw as Record<string, any>)) {
      if (!value || typeof value !== "object") continue;
      const x = typeof value.x === "number" ? value.x : undefined;
      const y = typeof value.y === "number" ? value.y : undefined;
      const vx = typeof value.vx === "number" ? value.vx : undefined;
      const vy = typeof value.vy === "number" ? value.vy : undefined;
      const facing = value.facing === "L" || value.facing === "R" ? value.facing : undefined;
      const hp = typeof value.hp === "number" ? value.hp : undefined;
      const name = typeof value.name === "string" ? value.name : undefined;
      players[uid] = {
        codename: name,
        pos: x !== undefined && y !== undefined ? { x, y } : undefined,
        vel: vx !== undefined && vy !== undefined ? { x: vx, y: vy } : undefined,
        dir: facing === "L" ? -1 : facing === "R" ? 1 : undefined,
        hp,
      };
    }
  }

  return {
    tick: typeof raw.tick === "number" ? raw.tick : undefined,
    players: Object.keys(players).length > 0 ? players : undefined,
    writerUid: typeof raw.writerUid === "string" ? raw.writerUid : undefined,
  };
}
