import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import type { InputIntent, MatchDoc, MatchStatus, Snapshot } from "../types/netcode";

export async function joinOrCreate1v1(
  arenaId: string,
  me: { playerId: string; codename: string },
): Promise<{ matchId: string; role: "referee" | "client"; slot: 1 | 2 }> {
  const matchesCol = collection(db, "matches");
  const q = query(matchesCol, where("arenaId", "==", arenaId), where("status", "==", "waiting"));
  let waitingId: string | undefined;
  const snap = await getDocs(q);
  snap.forEach((d) => {
    if (!waitingId) waitingId = d.id;
  });
  if (!waitingId) {
    const ref = await addDoc(matchesCol, {
      arenaId,
      players: [me],
      status: "waiting",
      tick: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { matchId: ref.id, role: "referee", slot: 1 };
  }
  const ref = doc(db, "matches", waitingId);
  const data = (await getDoc(ref)).data() as any;
  const players: { playerId: string; codename: string }[] = Array.isArray(data?.players) ? [...data.players] : [];
  if (players.length >= 2) {
    const ref2 = await addDoc(matchesCol, {
      arenaId,
      players: [me],
      status: "waiting",
      tick: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { matchId: ref2.id, role: "referee", slot: 1 };
  }
  players.push(me);
  await updateDoc(ref, { players, status: "active", updatedAt: serverTimestamp() });
  return { matchId: waitingId, role: "client", slot: 2 };
}

export async function writeInput(matchId: string, tick: number, slot: 1 | 2, input: InputIntent) {
  await setDoc(doc(db, "matches", matchId, "inputs", String(tick)), { t: tick, [`p${slot}`]: input }, { merge: true });
}

export async function getInputsForTick(matchId: string, tick: number): Promise<{ p1?: InputIntent; p2?: InputIntent }> {
  const d = (await getDoc(doc(db, "matches", matchId, "inputs", String(tick))))?.data() as any;
  return { p1: d?.p1, p2: d?.p2 };
}

export async function writeSnapshot(matchId: string, t: number, snap: Snapshot) {
  await setDoc(doc(db, "matches", matchId, "snapshots", String(t)), snap);
  await updateDoc(doc(db, "matches", matchId), { tick: t, updatedAt: serverTimestamp() });
}

export function subscribeSnapshots(matchId: string, onSnap: (s: Snapshot) => void) {
  const col = collection(db, "matches", matchId, "snapshots");
  return onSnapshot(col, (qs) => {
    let latest: Snapshot | undefined;
    qs.forEach((d) => {
      const s = d.data() as Snapshot;
      if (!latest || s.t > latest.t) latest = s;
    });
    if (latest) onSnap(latest);
  });
}

export function subscribeMatch(matchId: string, onMatch: (doc: MatchDoc) => void) {
  const ref = doc(db, "matches", matchId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const toIso = (value: any) => {
      if (!value) return new Date().toISOString();
      if (typeof value.toDate === "function") {
        const d = value.toDate();
        if (d?.toISOString) {
          return d.toISOString();
        }
      }
      if (value instanceof Date && value.toISOString) {
        return value.toISOString();
      }
      return String(value);
    };
    onMatch({
      id: snap.id,
      arenaId: String(data?.arenaId ?? ""),
      players: Array.isArray(data?.players) ? data.players.map((p: any) => ({
        playerId: String(p?.playerId ?? ""),
        codename: String(p?.codename ?? ""),
      })) : [],
      status: (data?.status ?? "waiting") as MatchStatus,
      tick: Number(data?.tick ?? 0),
      createdAt: toIso(data?.createdAt),
      updatedAt: data?.updatedAt ? toIso(data.updatedAt) : undefined,
    });
  });
}

export async function removePlayerFromMatch(matchId: string, playerId: string) {
  const ref = doc(db, "matches", matchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as any;
  const players = Array.isArray(data?.players)
    ? data.players.filter((p: any) => p?.playerId && p.playerId !== playerId)
    : [];
  await updateDoc(ref, { players, status: players.length >= 2 ? "active" : "waiting", updatedAt: serverTimestamp() });
}
