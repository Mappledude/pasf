import { auth, db } from "../firebase";
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const HEARTBEAT_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 3;

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

  const presenceId = uid;
  const ref = doc(db, "arenas", arenaId, "presence", presenceId);
  const path = ref.path;

  const displayName = profile?.displayName?.trim() || `Player ${uid.slice(-2)}`;

  const createPayload = {
    authUid: uid,
    uid,
    presenceId,
    playerId: playerId ?? uid,
    displayName,
    stage: "start" as const,
    lastSeen: serverTimestamp(),
    lastSeenSrv: serverTimestamp(),
    heartbeatMs: HEARTBEAT_MS,
    arenaId,
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
    if (stopped) return;
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

  const startTimer = () => {
    if (timer || stopped) return;
    timer = setInterval(() => {
      void beat();
    }, HEARTBEAT_MS);
  };

  const stopTimer = () => {
    clearTimer();
  };

  const onVisibilityChange = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      stopTimer();
    } else if (!stopped) {
      void beat();
      startTimer();
    }
  };

  if (typeof document !== "undefined") {
    if (document.visibilityState !== "hidden") {
      void beat();
      startTimer();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
  } else {
    startTimer();
  }

  const detachVisibility = () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };

  const deletePresence = async (source: string) => {
    try {
      await deleteDoc(ref);
      console.info("[PRESENCE] delete", { arenaId, presenceId, source });
    } catch (error: any) {
      console.error("[PRESENCE] delete-failed", {
        arenaId,
        presenceId,
        source,
        code: error?.code,
        message: error?.message,
      });
    }
  };

  const handlePageHide = () => {
    if (stopped) return;
    stopTimer();
    detachVisibility();
    detachWindowHandlers();
    void deletePresence("pagehide");
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
  }

  const detachWindowHandlers = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
    }
  };

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    stopTimer();
    detachVisibility();
    detachWindowHandlers();
    await deletePresence("stop");
  };

  return { presenceId, stop };
};
