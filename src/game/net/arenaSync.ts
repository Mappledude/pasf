import {
  applyDamage,
  respawnPlayer,
  updateArenaPlayerState,
  watchArenaState,
  type ArenaPlayerState,
} from "../../firebase";
import { debugLog } from "../../net/debug";

export type ArenaStateSnapshot = {
  tick?: number;
  lastUpdate?: unknown;
  players?: Record<string, (ArenaPlayerState & { updatedAt?: unknown }) | undefined>;
};

export interface ArenaHostOptions {
  arenaId: string;
  meId: string;
}

export interface ArenaPeerOptions {
  arenaId: string;
}

export interface ArenaHostService {
  setLocalState(partial: Partial<ArenaPlayerState>): void;
  applyDamage(targetPlayerId: string, amount: number): Promise<void>;
  respawn(spawn: { x: number; y: number }): Promise<void>;
  destroy(): void;
}

export interface ArenaPeerService {
  subscribe(cb: (state: ArenaStateSnapshot | undefined) => void): () => void;
  destroy(): void;
}

export const HOST_WRITE_INTERVAL_MS = 90;

const encoder = new TextEncoder();

type PlayerStatePartial = Partial<ArenaPlayerState>;

type Listener = (state: ArenaStateSnapshot | undefined) => void;

function shallowEqualState(a: PlayerStatePartial | null, b: PlayerStatePartial | null): boolean {
  if (!a || !b) {
    return false;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const ak = (a as Record<string, unknown>)[key];
    const bk = (b as Record<string, unknown>)[key];
    if (ak !== bk) {
      return false;
    }
  }
  return true;
}

export function createArenaHostService(options: ArenaHostOptions): ArenaHostService {
  const { arenaId, meId } = options;
  let destroyed = false;
  let queued: PlayerStatePartial | null = null;
  let lastSent: PlayerStatePartial | null = null;
  let tick = 0;

  const timer = setInterval(() => {
    if (destroyed || !queued) {
      return;
    }

    const next = queued;
    queued = null;

    if (shallowEqualState(lastSent, next)) {
      return;
    }

    lastSent = { ...next };
    tick += 1;

    const snapshot = { tick, players: { [meId]: next } };
    const bytes = encoder.encode(JSON.stringify(snapshot)).length;
    debugLog("[HOST] tick=%d wrote state (bytes=%d)", tick, bytes);

    updateArenaPlayerState(arenaId, meId, next, { tick }).catch((err) => {
      console.warn("[HOST] failed to write state", err);
    });
  }, HOST_WRITE_INTERVAL_MS);

  return {
    setLocalState(partial) {
      if (destroyed) {
        return;
      }
      queued = { ...(queued ?? {}), ...partial };
    },
    applyDamage(targetPlayerId, amount) {
      return applyDamage(arenaId, targetPlayerId, amount);
    },
    respawn(spawn) {
      return respawnPlayer(arenaId, meId, spawn);
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      clearInterval(timer);
      queued = null;
      lastSent = null;
    },
  };
}

export function createArenaPeerService(options: ArenaPeerOptions): ArenaPeerService {
  const { arenaId } = options;
  const listeners = new Set<Listener>();
  let unsubscribe: (() => void) | null = null;
  let destroyed = false;

  const ensureSubscription = () => {
    if (destroyed || unsubscribe) {
      return;
    }
    unsubscribe = watchArenaState(arenaId, (state) => {
      if (destroyed) {
        return;
      }
      const snapshot = state as ArenaStateSnapshot | undefined;
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
      if (destroyed) {
        return () => undefined;
      }
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
      if (destroyed) {
        return;
      }
      destroyed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      listeners.clear();
    },
  };
}
