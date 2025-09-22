import { auth, db } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { nanoid } from "nanoid";

export type PresenceDoc = {
  authUid: string;
  playerId?: string;
  profile?: { displayName?: string };
  lastSeen: number;
  lastSeenSrv?: any;
  createdAt?: any;
};

const HEARTBEAT_MS = 10000;

export const startPresence = async (arenaId: string, playerId?: string, profile?: { displayName?: string }) => {
  const authUid = auth.currentUser?.uid;
  if (!authUid) throw new Error("no-auth");
  const presenceId = nanoid(12);
  const ref = doc(db, "arenas", arenaId, "presence", presenceId);

  const write = async () => {
    const body: PresenceDoc = {
      authUid,
      playerId,
      profile,
      lastSeen: Date.now(),
      lastSeenSrv: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    await setDoc(ref, body, { merge: true });
  };

  await write();
  const timer = setInterval(write, HEARTBEAT_MS);

  const stop = async () => {
    clearInterval(timer);
    try {
      await setDoc(ref, { lastSeen: Date.now(), lastSeenSrv: serverTimestamp() }, { merge: true });
    } catch {}
  };

  window.addEventListener("beforeunload", stop, { once: true });
  return { presenceId, stop };
};
