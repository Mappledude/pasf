import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import type { InputIntent, MatchDoc, MatchStatus, Snapshot } from "../types/netcode";
import { nowMs } from "../utils/time";

const matchesCollection = collection(db, "matches");

function isoNow() {
  return new Date(nowMs()).toISOString();
}

function normalizeMatch(id: string, data: any): MatchDoc {
  const created = data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? isoNow();
  const updated = data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? undefined;
  const players = Array.isArray(data.players) ? data.players.map((p: any) => ({
    playerId: String(p?.playerId ?? ""),
    codename: String(p?.codename ?? ""),
  })) : [];
  return {
    id,
    arenaId: String(data.arenaId ?? ""),
    players,
    status: (data.status ?? "waiting") as MatchStatus,
    tick: Number(data.tick ?? 0),
    createdAt: created,
    updatedAt: updated,
  };
}

function normalizeSnapshot(docId: string, data: any): Snapshot {
  return {
    t: Number(data.t ?? Number(docId) ?? 0),
    p1: {
      x: Number(data.p1?.x ?? 0),
      y: Number(data.p1?.y ?? 0),
      vx: Number(data.p1?.vx ?? 0),
      vy: Number(data.p1?.vy ?? 0),
      hp: Number(data.p1?.hp ?? 100),
    },
    p2: {
      x: Number(data.p2?.x ?? 0),
      y: Number(data.p2?.y ?? 0),
      vx: Number(data.p2?.vx ?? 0),
      vy: Number(data.p2?.vy ?? 0),
      hp: Number(data.p2?.hp ?? 100),
    },
    events: Array.isArray(data.events) ? data.events.map((v: any) => String(v)) : undefined,
    ts: Number(data.ts ?? nowMs()),
  };
}

export async function createMatch(
  arenaId: string,
  players: { playerId: string; codename: string }[],
): Promise<string> {
  const createdAt = isoNow();
  const docRef = await addDoc(matchesCollection, {
    arenaId,
    players,
    status: players.length >= 2 ? "active" : "waiting",
    tick: 0,
    createdAt,
    updatedAt: createdAt,
  });
  return docRef.id;
}

export async function getMatch(matchId: string): Promise<MatchDoc | null> {
  const ref = doc(db, "matches", matchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return normalizeMatch(snap.id, snap.data());
}

export function subscribeMatch(matchId: string, onMatch: (match: MatchDoc) => void): () => void {
  const ref = doc(db, "matches", matchId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    onMatch(normalizeMatch(snap.id, snap.data()));
  });
}

export async function joinOrCreate1v1(
  arenaId: string,
  player: { playerId: string; codename: string },
): Promise<{ matchId: string; role: "referee" | "client" }> {
  const waitingQuery = query(
    matchesCollection,
    where("arenaId", "==", arenaId),
    where("status", "==", "waiting"),
  );
  const waiting = await getDocs(waitingQuery);

  for (const docSnap of waiting.docs) {
    const data = docSnap.data();
    const players = Array.isArray(data.players) ? [...data.players] : [];
    const filtered = players.filter((p: any) => p?.playerId);
    const existingIndex = filtered.findIndex((p: any) => p.playerId === player.playerId);
    let nextPlayers = filtered;
    if (existingIndex === -1 && filtered.length < 2) {
      nextPlayers = [...filtered, player];
    }
    const slot = nextPlayers.findIndex((p: any) => p.playerId === player.playerId);
    if (slot === -1) {
      continue;
    }
    const nextStatus: MatchStatus = nextPlayers.length >= 2 ? "active" : "waiting";
    await updateDoc(doc(db, "matches", docSnap.id), {
      players: nextPlayers,
      status: nextStatus,
      updatedAt: isoNow(),
    });
    return { matchId: docSnap.id, role: slot === 0 ? "referee" : "client" };
  }

  const matchId = await createMatch(arenaId, [player]);
  return { matchId, role: "referee" };
}

export async function writeInput(
  matchId: string,
  tick: number,
  slot: 1 | 2,
  input: InputIntent,
): Promise<void> {
  const ref = doc(db, "matches", matchId, "inputs", String(tick));
  const field = slot === 1 ? "p1" : "p2";
  await setDoc(
    ref,
    {
      t: tick,
      [field]: input,
    },
    { merge: true },
  );
}

export async function getInputsForTick(
  matchId: string,
  tick: number,
): Promise<{ p1?: InputIntent; p2?: InputIntent }> {
  const ref = doc(db, "matches", matchId, "inputs", String(tick));
  const snap = await getDoc(ref);
  if (!snap.exists()) return {};
  const data = snap.data() as any;
  return {
    p1: data.p1 as InputIntent | undefined,
    p2: data.p2 as InputIntent | undefined,
  };
}

export async function writeSnapshot(matchId: string, t: number, snap: Snapshot): Promise<void> {
  const ref = doc(db, "matches", matchId, "snapshots", String(t));
  await setDoc(ref, { ...snap });
  await updateDoc(doc(db, "matches", matchId), {
    tick: t,
    updatedAt: isoNow(),
  });
}

export async function removePlayerFromMatch(matchId: string, playerId: string): Promise<void> {
  const ref = doc(db, "matches", matchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as any;
  const players = Array.isArray(data.players)
    ? data.players.filter((p: any) => p?.playerId && p.playerId !== playerId)
    : [];
  const nextStatus: MatchStatus = players.length >= 2 ? "active" : players.length === 0 ? "waiting" : "waiting";
  await updateDoc(ref, {
    players,
    status: nextStatus,
    updatedAt: isoNow(),
  });
}

export async function getLatestSnapshot(matchId: string): Promise<Snapshot | null> {
  const snapsRef = collection(db, "matches", matchId, "snapshots");
  const q = query(snapsRef, orderBy("t", "desc"), limit(1));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  return normalizeSnapshot(docSnap.id, docSnap.data());
}

export function subscribeSnapshots(matchId: string, onSnap: (snap: Snapshot) => void): () => void {
  const snapsRef = collection(db, "matches", matchId, "snapshots");
  const q = query(snapsRef, orderBy("t", "desc"), limit(1));
  return onSnapshot(q, (snapshot) => {
    const docSnap = snapshot.docs[0];
    if (!docSnap) return;
    onSnap(normalizeSnapshot(docSnap.id, docSnap.data()));
  });
}
