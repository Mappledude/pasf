import { auth, db } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
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

  const basePayload = {
    authUid: uid,
    playerId: playerId ?? null,
    profile: profile ?? null,
    lastSeen: Date.now(),
    lastSeenSrv: serverTimestamp(),
  } as const;

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
    const payload = { ...basePayload, stage };
    console.info("[PRESENCE] write-attempt", {
      stage,
      path,
      arenaId,
      presenceId,
      uid,
      hasAuthUid: Object.prototype.hasOwnProperty.call(payload, "authUid"),
      authMatches: payload.authUid === uid,
    });

    try {
      await setDoc(ref, payload, { merge: true });
      consecutiveFailures = 0;
      console.info(stage === "start" ? "[PRESENCE] started" : "[PRESENCE] beat", {
        arenaId,
        presenceId,
        uid,
        path,
      });
    } catch (e: any) {
      consecutiveFailures += 1;
      console.error("[PRESENCE] write-failed", {
        stage,
        code: e?.code,
        message: e?.message,
        path,
        arenaId,
        presenceId,
        uid,
      });
      if (stage === "start") {
        clearTimer();
        const error = e instanceof Error ? e : new Error(String(e ?? "presence-start-failed"));
        throw error;
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
    try {
      await setDoc(ref, { lastSeen: Date.now(), lastSeenSrv: serverTimestamp(), stage: "stop" }, { merge: true });
    } catch (e: any) {
      console.error("[PRESENCE] stop-failed", { code: e?.code, message: e?.message });
    }
  };

  window.addEventListener("beforeunload", stop, { once: true });
  return { presenceId, stop };
};
