import { auth, db } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { nanoid } from "nanoid";

const HEARTBEAT_MS = 10000;

export const startPresence = async (arenaId: string, playerId?: string, profile?: { displayName?: string }) => {
  const uid = auth.currentUser?.uid;
  if (!uid) { console.error("[PRESENCE] write-failed", { reason: "no-auth" }); throw new Error("no-auth"); }
  const presenceId = nanoid(10);
  const ref = doc(db, "arenas", arenaId, "presence", presenceId);

  const write = async (stage: "start"|"beat") => {
    try {
      await setDoc(ref, {
        authUid: uid,
        playerId: playerId ?? null,
        profile: profile ?? null,
        lastSeen: Date.now(),
        lastSeenSrv: serverTimestamp(),
        stage,
      }, { merge: true });
      if (stage === "start") console.info("[PRESENCE] started", { arenaId, presenceId, uid });
      else console.info("[PRESENCE] beat", { presenceId });
    } catch (e: any) {
      console.error("[PRESENCE] write-failed", { code: e?.code, message: e?.message });
    }
  };

  await write("start");
  const timer = setInterval(() => write("beat"), HEARTBEAT_MS);

  const stop = async () => {
    clearInterval(timer);
    try { await setDoc(ref, { lastSeen: Date.now(), lastSeenSrv: serverTimestamp(), stage: "stop" }, { merge: true }); }
    catch (e: any) { console.error("[PRESENCE] stop-failed", { code: e?.code, message: e?.message }); }
  };

  window.addEventListener("beforeunload", stop, { once: true });
  return { presenceId, stop };
};
