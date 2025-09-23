import { auth, db } from "../firebase";
import { collection, doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";

export const ensureArenaFixed = async (arenaId: string, database: Firestore = db) => {
  const aRef = doc(database, "arenas", arenaId);
  const sRef = doc(database, "arenas", arenaId, "state", "current");
  const aSnap = await getDoc(aRef);
  let createdArena = false;
  if (!aSnap.exists()) {
    await setDoc(aRef, { id: arenaId, title: arenaId, createdAt: Date.now() }, { merge: true });
    createdArena = true;
  }
  await setDoc(
    aRef,
    {
      seeded: true,
      touchedAt: serverTimestamp(),
    },
    { merge: true },
  );
  const sSnap = await getDoc(sRef);
  let createdState = false;
  if (!sSnap.exists()) {
    // seed minimal state
    await setDoc(sRef, { tick: 0, ents: {}, createdAt: Date.now() }, { merge: true });
    createdState = true;
  }

  let probeWarning = false;
  try {
    const probeRef = doc(collection(aRef, "state"), "bootstrap-probe");
    await setDoc(
      probeRef,
      { at: serverTimestamp(), ok: true, who: auth.currentUser?.uid ?? "unknown" },
      { merge: true },
    );
    console.info("[ARENA] rules-probe ok", { arenaId });
  } catch (error: any) {
    const code = error?.code ?? error?.name;
    const message = String(error?.message ?? error);
    if (code === "permission-denied") {
      console.warn("[ARENA] rules-probe non-fatal", { arenaId, code, message });
      probeWarning = true;
    } else {
      console.error("[ARENA] rules-probe failed", { arenaId, code, message });
      throw error;
    }
  }
  return { aRef, sRef, createdArena, createdState, probeWarning };
};
