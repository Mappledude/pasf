import { doc, getDoc, setDoc, serverTimestamp, type DocumentReference } from "firebase/firestore";
import { db } from "../firebase";

export function arenaStateDoc(arenaId: string) {
  // Single document at /arenas/{arenaId}/state
  return doc(db, "arenas", arenaId, "state") as DocumentReference;
}

export async function ensureArenaState(arenaId: string) {
  const ref = arenaStateDoc(arenaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { tick: 0, lastUpdate: serverTimestamp(), players: {} }, { merge: true });
  }
  return ref;
}
