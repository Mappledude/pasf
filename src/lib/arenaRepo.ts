import { auth, db } from "../firebase";
import { doc, getDoc, type Firestore } from "firebase/firestore";

export const ensureArenaFixed = async (arenaId: string, database: Firestore = db) => {
  const aRef = doc(database, "arenas", arenaId);
  const sRef = doc(database, "arenas", arenaId, "state", "current");
  let createdArena = false;
  let createdState = false;
  let probeWarning = false;

  try {
    const aSnap = await getDoc(aRef);
    createdArena = !aSnap.exists();
  } catch (error: any) {
    const code = error?.code ?? error?.name;
    const message = String(error?.message ?? error);
    if (code === "permission-denied") {
      probeWarning = true;
      console.warn("[ARENA] arena-read denied", {
        arenaId,
        code,
        message,
        uid: auth.currentUser?.uid ?? null,
      });
    } else {
      throw error;
    }
  }

  try {
    const sSnap = await getDoc(sRef);
    createdState = !sSnap.exists();
  } catch (error: any) {
    const code = error?.code ?? error?.name;
    const message = String(error?.message ?? error);
    if (code === "permission-denied") {
      probeWarning = true;
      console.warn("[ARENA] state-read denied", {
        arenaId,
        code,
        message,
        uid: auth.currentUser?.uid ?? null,
      });
    } else {
      throw error;
    }
  }

  try {
    await getDoc(doc(database, "arenas", arenaId, "state", "bootstrap-probe"));
    console.info("[ARENA] rules-probe read ok", { arenaId });
  } catch (error: any) {
    const code = error?.code ?? error?.name;
    const message = String(error?.message ?? error);
    if (code === "permission-denied") {
      probeWarning = true;
      console.warn("[ARENA] rules-probe read denied", {
        arenaId,
        code,
        message,
        uid: auth.currentUser?.uid ?? null,
      });
    } else {
      console.error("[ARENA] rules-probe read failed", { arenaId, code, message });
      throw error;
    }
  }

  return { aRef, sRef, createdArena, createdState, probeWarning };
};
