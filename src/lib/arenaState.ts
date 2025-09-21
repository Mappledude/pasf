import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Firestore,
  type DocumentReference,
  type Unsubscribe,
} from "firebase/firestore";

import { ensureAnonAuth } from "../firebase";

export type ArenaState = {
  tick: number;
  writerUid?: string | null;
  lastWriter?: string | null;
  ts?: number;
  lastUpdate?: unknown; // Firestore Timestamp
  entities?: Record<string, { hp?: number; updatedAt?: unknown; x?: number; y?: number }>;
};

export const arenaStateRef = (db: Firestore, arenaId: string): DocumentReference =>
  doc(db, "arenas", arenaId, "state", "current");

export async function ensureArenaState(
  db: Firestore,
  arenaId: string
): Promise<void> {
  console.info("[ARENA] ensureArenaState: start", { arenaId });
  await ensureAnonAuth();
  const ref = arenaStateRef(db, arenaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.info("[ARENA] ensureArenaState: creating doc", { arenaId });
    await setDoc(
      ref,
      {
        tick: 0,
        writerUid: null,
        lastWriter: null,
        ts: Date.now(),
        entities: {},
        lastUpdate: serverTimestamp(),
      } as ArenaState,
      { merge: true }
    );
  }
  console.info("[ARENA] ensureArenaState: ready", { arenaId, created: !snap.exists() });
}

export async function watchArenaState(
  db: Firestore,
  arenaId: string,
  onOk: (state: ArenaState | undefined) => void,
  onErr: (e: unknown) => void
): Promise<Unsubscribe> {
  await ensureAnonAuth();
  const ref = arenaStateRef(db, arenaId);
  console.info("[ARENA] watchArenaState: subscribing", { arenaId });
  const unsubscribe = onSnapshot(
    ref,
    (s) => {
      console.info("[ARENA] watchArenaState: snapshot", {
        arenaId,
        exists: s.exists(),
      });
      onOk(s.exists() ? (s.data() as ArenaState) : undefined);
    },
    (e) => {
      console.error("[ARENA] watchArenaState: error", { arenaId, error: e });
      onErr(e);
    }
  );
  return () => {
    console.info("[ARENA] watchArenaState: unsubscribing", { arenaId });
    unsubscribe();
  };
}

export async function touchPlayer(
  db: Firestore,
  arenaId: string,
  initHp = 100
) {
  const user = await ensureAnonAuth();
  console.info("[ARENA] touchPlayer", { arenaId, uid: user.uid });
  const ref = arenaStateRef(db, arenaId);
  await setDoc(
    ref,
    {
      lastUpdate: serverTimestamp(),
    },
    { merge: true }
  );
  console.info("[ARENA] touchPlayer: updated", { arenaId, uid: user.uid });
}
