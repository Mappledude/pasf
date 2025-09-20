import { applyDamage, respawnPlayer, updateArenaPlayerState, watchArenaState, type ArenaPlayerState } from "../../firebase";

export type ArenaStateSnapshot = {
  tick?: number;
  lastUpdate?: unknown;
  players?: Record<string, (ArenaPlayerState & { updatedAt?: unknown }) | undefined>;
};

export interface ArenaSyncOptions {
  arenaId: string;
  meId: string;
  throttleMs?: number;
}

export interface ArenaSync {
  updateLocalState(partial: Partial<ArenaPlayerState>): void;
  subscribe(cb: (state: ArenaStateSnapshot | undefined) => void): () => void;
  applyDamage(targetPlayerId: string, amount: number): Promise<void>;
  respawn(spawn: { x: number; y: number }): Promise<void>;
  destroy(): void;
}

export function createArenaSync(options: ArenaSyncOptions): ArenaSync {
  const { arenaId, meId, throttleMs = 50 } = options;
  const listeners = new Set<(state: ArenaStateSnapshot | undefined) => void>();

  let queued: Partial<ArenaPlayerState> | null = null;
  let lastSent = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let destroyed = false;

  const flush = () => {
    if (!queued) return;
    const payload = queued;
    queued = null;
    lastSent = Date.now();
    updateArenaPlayerState(arenaId, meId, payload).catch((err) => {
      console.warn("[arenaSync] failed to update player state", err);
    });
  };

  const scheduleFlush = () => {
    if (destroyed) return;
    const now = Date.now();
    const elapsed = now - lastSent;
    const delay = Math.max(0, throttleMs - elapsed);
    if (delay === 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      flush();
      return;
    }

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      flush();
    }, delay);
  };

  const ensureSubscription = () => {
    if (unsubscribe) return;
    unsubscribe = watchArenaState(arenaId, (state) => {
      listeners.forEach((listener) => {
        try {
          listener(state as ArenaStateSnapshot | undefined);
        } catch (err) {
          console.warn("[arenaSync] listener error", err);
        }
      });
    });
  };

  return {
    updateLocalState(partial: Partial<ArenaPlayerState>) {
      if (destroyed) return;
      queued = { ...(queued ?? {}), ...partial };
      scheduleFlush();
    },
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
    applyDamage(targetPlayerId: string, amount: number) {
      return applyDamage(arenaId, targetPlayerId, amount);
    },
    respawn(spawn) {
      return respawnPlayer(arenaId, meId, spawn);
    },
    destroy() {
      destroyed = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      listeners.clear();
      queued = null;
    },
  };
}
