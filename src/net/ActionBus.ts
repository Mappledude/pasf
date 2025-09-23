import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

export type InputPayload = { type: string; [k: string]: unknown };

export const writeArenaInput = async (arenaId: string, presenceId: string, payload: InputPayload) => {
  const authUid = auth.currentUser?.uid;
  if (!authUid) {
    console.info("[INPUT] rejected", { presenceId, reason: "no-auth" });
    return;
  }
  const ref = doc(db, "arenas", arenaId, "inputs", presenceId);
  const now = serverTimestamp();
  const data: Record<string, unknown> = {
    authUid,
    playerId: presenceId,
    presenceId,
    updatedAt: now,
  };

  if (typeof payload.left === "boolean") data.left = payload.left;
  if (typeof payload.right === "boolean") data.right = payload.right;
  if (typeof payload.jump === "boolean") data.jump = payload.jump;
  if (typeof payload.attack === "boolean") data.attack = payload.attack;
  if (typeof payload.attackSeq === "number") data.attackSeq = payload.attackSeq;
  if (typeof payload.codename === "string" && payload.codename.length > 0) {
    data.codename = payload.codename;
  }

  await setDoc(ref, data, { merge: true });
  console.info("[INPUT] enqueued", { presenceId, type: payload?.type });
};
