import { db } from "../firebase";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  Timestamp,
  type DocumentData,
} from "firebase/firestore";
import { dbg } from "./debug";

const PRESENCE_STALE_MS = 20_000;  // lastSeen ≤ 20s
const HEARTBEAT_MS = 10_000;

function toMillis(v: any): number {
  if (typeof v === "number") return v;
  if (v?.toMillis) try { return v.toMillis(); } catch {}
  if (v?.toDate)   try { return v.toDate().getTime(); } catch {}
  return 0;
}

export type LivePresence = {
  id: string;
  authUid?: string;
  lastSeen?: number | any;
  presenceId?: string;
} & DocumentData;

export function watchArenaPresence(arenaId: string, onChange: (live: LivePresence[]) => void) {
  const col = collection(db, "arenas", arenaId, "presence");
  return onSnapshot(col, (snap) => {
    const now = Date.now();
    const live = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(p => (now - toMillis(p.lastSeen)) <= PRESENCE_STALE_MS) as LivePresence[];
    console.info("[PRESENCE] live", { live: live.length, all: snap.size });
    dbg("presence:live", { arenaId, live: live.length, all: snap.size });
    onChange(live);
  });
}

export function startPresenceHeartbeat(arenaId: string, presenceId: string, authUid: string) {
  const ref = doc(db, "arenas", arenaId, "presence", presenceId);

  const tick = async () => {
    await setDoc(
      ref,
      { presenceId, authUid, lastSeen: Timestamp.fromMillis(Date.now()) },
      { merge: true },
    );
    console.info("[PRESENCE] beat", { presenceId });
    dbg("presence:beat", { arenaId, presenceId });
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  void tick();
  timer = setInterval(tick, HEARTBEAT_MS);

  return () => { if (timer) clearInterval(timer); };
}
