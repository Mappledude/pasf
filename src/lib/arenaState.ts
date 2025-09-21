import {
  doc, getDoc, onSnapshot, setDoc, serverTimestamp,
  type Firestore, type DocumentReference
} from "firebase/firestore";
import type { User } from "firebase/auth";

export type ArenaState = {
  tick: number;
  lastUpdate?: unknown; // Firestore Timestamp
  players: Record<string, { hp: number; updatedAt?: unknown }>;
};

export const arenaStateRef = (db: Firestore, arenaId: string): DocumentReference =>
  doc(db, "arenas", arenaId, "state");

export async function ensureArenaState(
  db: Firestore,
  arenaId: string
): Promise<void> {
  const ref = arenaStateRef(db, arenaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(
      ref,
      { tick: 0, players: {}, lastUpdate: serverTimestamp() } as ArenaState,
      { merge: true }
    );
  }
}

export function watchArenaState(
  db: Firestore,
  arenaId: string,
  onOk: (state: ArenaState | undefined) => void,
  onErr: (e: unknown) => void
) {
  const ref = arenaStateRef(db, arenaId);
  return onSnapshot(
    ref,
    (s) => onOk(s.exists() ? (s.data() as ArenaState) : undefined),
    onErr
  );
}

export async function touchPlayer(
  db: Firestore,
  arenaId: string,
  user: User,
  initHp = 100
) {
  const ref = arenaStateRef(db, arenaId);
  await setDoc(
    ref,
    {
      lastUpdate: serverTimestamp(),
      players: {
        [user.uid]: { hp: initHp, updatedAt: serverTimestamp() },
      },
    },
    { merge: true }
  );
}
