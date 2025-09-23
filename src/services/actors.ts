import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { getDisplayName } from "./users";

export type ActorPatch = {
  x: number;
  y: number;
  facing: "L" | "R";
  anim: string;
  seq: number;
};

export async function upsertMyActor(
  db: Firestore,
  arenaId: string,
  uid: string,
  patch: ActorPatch,
): Promise<void> {
  const dn = await getDisplayName(db);
  const ref = doc(db, "arenas", arenaId, "actors", uid);
  await setDoc(
    ref,
    {
      uid,
      dn,
      x: Math.round(patch.x),
      y: Math.round(patch.y),
      facing: patch.facing,
      anim: patch.anim,
      seq: patch.seq,
      ts: serverTimestamp(),
    },
    { merge: true },
  );
}
