import { watchArenaState, type ArenaPlayerState } from "../../firebase";
import {
  disposeActionBus,
  initActionBus,
  publishInput,
  type PlayerInput,
} from "../../net/ActionBus";

export type ArenaStateSnapshot = {
  tick?: number;
  lastUpdate?: unknown;
  players?: Record<string, (ArenaPlayerState & { updatedAt?: unknown }) | undefined>;
};

export interface ArenaSyncOptions {
  arenaId: string;
  meId: string;
  codename?: string;
}

export interface ArenaSync {
  updateLocalState(input: PlayerInput): void;
  subscribe(cb: (state: ArenaStateSnapshot | undefined) => void): () => void;
  destroy(): void;
}

export function createArenaSync(options: ArenaSyncOptions): ArenaSync {
  const { arenaId, meId, codename } = options;
  const listeners = new Set<(state: ArenaStateSnapshot | undefined) => void>();

  let unsubscribe: (() => void) | null = null;
  let destroyed = false;

  void initActionBus({ arenaId, playerId: meId, codename }).catch((err) => {
    console.warn("[arenaSync] failed to init action bus", err);
  });

  const ensureSubscription = () => {
    if (unsubscribe || destroyed) return;
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
    updateLocalState(input: PlayerInput) {
      if (destroyed) return;
      publishInput({ ...input, codename });
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
    destroy() {
      destroyed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      listeners.clear();
      disposeActionBus();
    },
  };
}
