import type { InputIntent, Snapshot } from "../types/netcode";
import { subscribeSnapshots, writeInput } from "./refereeStore";

export function startClientLoop(
  matchId: string,
  slot: 1 | 2,
  getLocalIntent: () => InputIntent,
  onSnapshot: (s: Snapshot) => void,
) {
  let lastSeq = -1;
  let latestTick = 0;
  const unsub = subscribeSnapshots(matchId, (snap) => {
    latestTick = Math.max(latestTick, snap.t);
    onSnapshot(snap);
  });
  const send = setInterval(() => {
    const intent = getLocalIntent();
    if (intent.seq !== lastSeq) {
      lastSeq = intent.seq;
    }
    const targetTick = latestTick + 1;
    writeInput(matchId, targetTick, slot, intent).catch(() => {});
  }, 50);
  return () => {
    clearInterval(send);
    unsub();
  };
}
