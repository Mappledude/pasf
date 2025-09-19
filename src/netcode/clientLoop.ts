import type { InputIntent, Snapshot } from "../types/netcode";
import { subscribeSnapshots, writeInput } from "./refereeStore";

export function startClientLoop(
  matchId: string,
  slot: 1 | 2,
  getLocalIntent: () => InputIntent,
  onSnapshot: (s: Snapshot) => void,
): () => void {
  let disposed = false;
  let latestTick = 0;
  let lastSeqSent = -1;
  let writing = false;

  const unsubscribe = subscribeSnapshots(matchId, (snap) => {
    latestTick = Math.max(latestTick, snap.t);
    onSnapshot(snap);
  });

  const interval = setInterval(() => {
    if (disposed || writing) return;
    const intent = getLocalIntent();
    if (intent.seq === lastSeqSent) return;
    writing = true;
    const targetTick = latestTick + 1;
    writeInput(matchId, targetTick, slot, intent)
      .then(() => {
        lastSeqSent = intent.seq;
      })
      .catch((err) => {
        console.warn("[clientLoop] failed to write input", err);
      })
      .finally(() => {
        writing = false;
      });
  }, 50);

  return () => {
    disposed = true;
    clearInterval(interval);
    unsubscribe();
  };
}
