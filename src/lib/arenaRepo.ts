import { db } from "../firebase";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";

export const ensureArenaFixed = async (arenaId: string, database: Firestore = db) => {
  const aRef = doc(database, "arenas", arenaId);
  const sRef = doc(database, "arenas", arenaId, "state", "current");
  const aSnap = await getDoc(aRef);
  let createdArena = false;
  if (!aSnap.exists()) {
    await setDoc(aRef, { id: arenaId, title: arenaId, createdAt: Date.now() }, { merge: true });
    createdArena = true;
  }
  const sSnap = await getDoc(sRef);
  let createdState = false;
  if (!sSnap.exists()) {
    // seed minimal state
    await setDoc(sRef, { tick: 0, ents: {}, createdAt: Date.now() }, { merge: true });
    createdState = true;
  }
  return { aRef, sRef, createdArena, createdState };
};
