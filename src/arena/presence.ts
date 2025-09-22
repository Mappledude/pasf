import { auth, db } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { nanoid } from "nanoid";

const HEARTBEAT_MS = 10000;
const MAX_CONSECUTIVE_FAILURES = 3;

export const startPresence = async (arenaId: string, playerId?: string, profile?: { displayName?: string }) => {
  const uid = auth.currentUser?.uid;
  if (!uid) { console.error("[PRESENCE] write-failed", { reason: "no-auth" }); throw new Error("no-auth"); }
  const presenceId = nanoid(10);
  const ref = doc(db, "arenas", arenaId, "presence", presenceId);

  let timer: ReturnType<typeof setInterval> | undefined;
  let consecutiveFailures = 0;
  let stopped = false;

  const clearTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const write = async (stage: "start" | "beat") => {
    try {
      await setDoc(ref, {
        authUid: uid,
        playerId: playerId ?? null,
        profile: profile ?? null,
        lastSeen: Date.now(),
        lastSeenSrv: serverTimestamp(),
        stage,
      }, { merge: true });
      consecutiveFailures = 0;
      if (stage === "start") console.info("[PRESENCE] started", { arenaId, presenceId, uid });
      else console.info("[PRESENCE] beat", { presenceId });
    } catch (e: any) {
      consecutiveFailures += 1;
      console.error("[PRESENCE] write-failed", { stage, code: e?.code, message: e?.message });
      if (stage === "start") {
        clearTimer();
        throw e instanceof Error ? e : new Error(String(e ?? "presence-start-failed"));
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error("[PRESENCE] heartbeat-stopped", { presenceId, failures: consecutiveFailures });
        clearTimer();
      }
    }
  };

  await write("start");
  timer = setInterval(() => {
    void write("beat");
  }, HEARTBEAT_MS);

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    try { await setDoc(ref, { lastSeen: Date.now(), lastSeenSrv: serverTimestamp(), stage: "stop" }, { merge: true }); }
    catch (e: any) { console.error("[PRESENCE] stop-failed", { code: e?.code, message: e?.message }); }
  };

  window.addEventListener("beforeunload", stop, { once: true });
  return { presenceId, stop };
};
