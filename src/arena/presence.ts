import { auth, db } from "../firebase";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { nanoid } from "nanoid";

const HEARTBEAT_MS = 10000;
const MAX_CONSECUTIVE_FAILURES = 3;

const generatePresenceId = () => nanoid(10);

export const startPresence = async (arenaId: string, playerId?: string, profile?: { displayName?: string }) => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error("[PRESENCE] write-failed", { reason: "no-auth" });
    throw new Error("no-auth");
  }

  try {
    await setDoc(
      doc(db, "arenas", arenaId),
      { rulesProbeAt: serverTimestamp(), rulesProbeBy: uid },
      { merge: true },
    );
    console.info("[ARENA] rules-probe ok", { arenaId });
  } catch (e: any) {
    console.error("[ARENA] rules-probe failed", {
      arenaId,
      code: e?.code,
      message: e?.message,
    });
  }

  const presenceId = generatePresenceId();
  const ref = doc(db, "arenas", arenaId, "presence", presenceId);
  const path = ref.path;

  const displayName = profile?.displayName?.trim() || `Player ${uid.slice(-2)}`;

  const createPayload = {
    authUid: uid,
    presenceId,
    playerId: playerId ?? uid,
    displayName,
    stage: "start" as const,
    lastSeen: serverTimestamp(),
    lastSeenSrv: serverTimestamp(),
    heartbeatMs: HEARTBEAT_MS,
  };

  console.info("[PRESENCE] write-attempt", {
    stage: "start",
    path,
    arenaId,
    presenceId,
    uid,
    hasAuthUid: true,
    authMatches: true,
  });

  try {
    await setDoc(ref, createPayload, { merge: false });
    console.info("[PRESENCE] started", { arenaId, presenceId, uid, path, displayName });
  } catch (e: any) {
    console.error("[PRESENCE] write-failed", {
      stage: "start",
      code: e?.code,
      message: e?.message,
      path,
      arenaId,
      presenceId,
      uid,
    });
    throw (e instanceof Error ? e : new Error(String(e ?? "presence-start-failed")));
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let consecutiveFailures = 0;
  let stopped = false;

  const clearTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const beat = async () => {
    console.info("[PRESENCE] write-attempt", {
      stage: "beat",
      path,
      arenaId,
      presenceId,
      uid,
      hasAuthUid: true,
      authMatches: true,
    });

    try {
      await updateDoc(ref, {
        stage: "beat",
        lastSeen: serverTimestamp(),
        lastSeenSrv: serverTimestamp(),
      });
      consecutiveFailures = 0;
      console.info("[PRESENCE] beat", { arenaId, presenceId, uid, path });
    } catch (e: any) {
      consecutiveFailures += 1;
      console.error("[PRESENCE] beat-failed", {
        code: e?.code,
        message: e?.message,
        path,
        arenaId,
        presenceId,
        uid,
        failures: consecutiveFailures,
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error("[PRESENCE] heartbeat-stopped", { presenceId, failures: consecutiveFailures });
        clearTimer();
      }
    }
  };

  timer = setInterval(() => {
    void beat();
  }, HEARTBEAT_MS);

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    try {
      await updateDoc(ref, {
        stage: "stop",
        lastSeen: serverTimestamp(),
        lastSeenSrv: serverTimestamp(),
      });
    } catch (e: any) {
      console.error("[PRESENCE] stop-failed", { code: e?.code, message: e?.message });
    }
  };

  window.addEventListener("beforeunload", stop, { once: true });
  return { presenceId, stop };
};
