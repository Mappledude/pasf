import { publishInput } from "../../net/ActionBus";
import { createArenaPeerService, type ArenaPeerService, type ArenaStateSnapshot } from "./arenaSync";

export type AuthoritativeSnapshot = ArenaStateSnapshot;

export type MatchRole = "host" | "peer";
export type MatchSeat = "A" | "B";

export interface MatchChannel {
  publishInputs(payload: Record<string, unknown>): void;
  onSnapshot(cb: (snapshot: AuthoritativeSnapshot | undefined) => void): () => void;
  onRoleChange?(cb: (role: MatchRole) => void): () => void;
  onSeatChange?(cb: (seat: MatchSeat | undefined) => void): () => void;
  destroy(): void;
}

interface CreateMatchChannelOptions {
  arenaId: string;
}

export function createMatchChannel(options: CreateMatchChannelOptions): MatchChannel {
  const peer: ArenaPeerService = createArenaPeerService({ arenaId: options.arenaId });
  const snapshotListeners = new Set<(snapshot: AuthoritativeSnapshot | undefined) => void>();
  let unsubscribe: (() => void) | null = null;

  const ensureSubscribed = () => {
    if (unsubscribe) return;
    unsubscribe = peer.subscribe((snapshot) => {
      snapshotListeners.forEach((listener) => {
        listener(snapshot);
      });
    });
  };

  return {
    publishInputs(payload) {
      publishInput({
        left: !!payload.left,
        right: !!payload.right,
        jump: !!payload.jump || !!payload.up,
        attack: !!payload.attack || !!payload.attack1 || !!payload.attack2,
        codename: typeof payload.codename === "string" ? payload.codename : undefined,
      });
    },
    onSnapshot(cb) {
      snapshotListeners.add(cb);
      ensureSubscribed();
      return () => {
        snapshotListeners.delete(cb);
        if (snapshotListeners.size === 0 && unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
    onRoleChange(cb) {
      cb("peer");
      return () => undefined;
    },
    onSeatChange(cb) {
      cb(undefined);
      return () => undefined;
    },
    destroy() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      snapshotListeners.clear();
      peer.destroy();
    },
  };
}
