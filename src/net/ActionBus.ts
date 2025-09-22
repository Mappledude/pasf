import { addDoc, collection, doc } from "firebase/firestore";
import { auth, db } from "../firebase";

export type InputPayload = { type: string; [k: string]: unknown };

export const writeArenaInput = async (arenaId: string, presenceId: string, payload: InputPayload) => {
  const authUid = auth.currentUser?.uid;
  if (!authUid) {
    console.info("[INPUT] rejected", { presenceId, reason: "no-auth" });
    return;
  }
  const ref = collection(doc(db, "arenas", arenaId), "inputs", presenceId, "events");
  await addDoc(ref, { ...payload, authUid, presenceId, createdAt: Date.now() });
  console.info("[INPUT] enqueued", { presenceId, type: payload?.type });
};
