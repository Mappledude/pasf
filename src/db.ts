import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  query,
  orderBy
} from "firebase/firestore";
import { db } from "./firebase";

export interface PlayerSummary {
  id: string;
  name: string;
  passcodeId?: string;
  stats?: Record<string, number>;
}

export interface ArenaSummary {
  id: string;
  name: string;
  active: boolean;
  presence: ArenaPresence[];
}

export interface ArenaPresence {
  playerId: string;
  playerName: string;
  joinedAt?: unknown;
}

export async function resolvePasscode(passcode: string): Promise<{ playerId: string; name: string } | null> {
  const ref = doc(db, "passcodes", passcode);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const { playerId } = snap.data() as { playerId: string };
  const p = await getDoc(doc(db, "players", playerId));
  if (!p.exists()) return null;
  const d = p.data() as { name?: string };
  return { playerId: p.id, name: d.name ?? "Unknown" };
}

export async function bossCreatePlayer(name: string, passcode: string): Promise<string> {
  const pRef = doc(collection(db, "players"));
  await setDoc(pRef, {
    name,
    passcodeId: passcode,
    stats: { wins: 0, losses: 0, damageDealt: 0, damageTaken: 0 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const pcRef = doc(db, "passcodes", passcode);
  await setDoc(pcRef, { playerId: pRef.id, createdAt: serverTimestamp() });
  return pRef.id;
}

export async function bossDeletePlayerById(playerId: string): Promise<void> {
  const pRef = doc(db, "players", playerId);
  const pSnap = await getDoc(pRef);
  if (pSnap.exists()) {
    const passcodeId = (pSnap.data() as { passcodeId?: string }).passcodeId;
    if (passcodeId) {
      await deleteDoc(doc(db, "passcodes", passcodeId));
    }
  }
  await deleteDoc(pRef);
}

export async function bossCreateArena(name: string): Promise<string> {
  const aRef = await addDoc(collection(db, "arenas"), {
    name,
    active: true,
    createdAt: serverTimestamp()
  });
  return aRef.id;
}

export async function bossDeleteArena(arenaId: string): Promise<void> {
  await deleteDoc(doc(db, "arenas", arenaId));
}

export async function joinArena(arenaId: string, playerId: string, playerName: string): Promise<void> {
  await setDoc(doc(db, `arenas/${arenaId}/presence/${playerId}`), {
    playerName,
    joinedAt: serverTimestamp()
  });
}

export async function leaveArena(arenaId: string, playerId: string): Promise<void> {
  await deleteDoc(doc(db, `arenas/${arenaId}/presence/${playerId}`));
}

export async function listPlayers(): Promise<PlayerSummary[]> {
  const snap = await getDocs(collection(db, "players"));
  return snap.docs.map((d) => {
    const data = d.data() as { name?: string; passcodeId?: string; stats?: Record<string, number> };
    return {
      id: d.id,
      name: data.name ?? "Unnamed",
      passcodeId: data.passcodeId,
      stats: data.stats
    };
  });
}

export async function listArenas(): Promise<ArenaSummary[]> {
  const arenas = await getDocs(collection(db, "arenas"));
  const entries = await Promise.all(
    arenas.docs.map(async (arena) => {
      const presenceSnap = await getDocs(collection(db, `arenas/${arena.id}/presence`));
      const presence = presenceSnap.docs.map((p) => {
        const pdata = p.data() as { playerName?: string; joinedAt?: unknown };
        return {
          playerId: p.id,
          playerName: pdata.playerName ?? "Unknown",
          joinedAt: pdata.joinedAt
        };
      });
      const data = arena.data() as { name?: string; active?: boolean };
      return {
        id: arena.id,
        name: data.name ?? "Arena",
        active: data.active ?? false,
        presence
      } as ArenaSummary;
    })
  );
  return entries;
}

export function listenToArenas(callback: (arenas: ArenaSummary[]) => void): () => void {
  const arenasRef = collection(db, "arenas");
  return onSnapshot(arenasRef, async (snapshot) => {
    const arenas = await Promise.all(
      snapshot.docs.map(async (arena) => {
        const presenceSnap = await getDocs(collection(db, `arenas/${arena.id}/presence`));
        const presence = presenceSnap.docs.map((p) => {
          const pdata = p.data() as { playerName?: string; joinedAt?: unknown };
          return {
            playerId: p.id,
            playerName: pdata.playerName ?? "Unknown",
            joinedAt: pdata.joinedAt
          };
        });
        const data = arena.data() as { name?: string; active?: boolean };
        return {
          id: arena.id,
          name: data.name ?? "Arena",
          active: data.active ?? false,
          presence
        } as ArenaSummary;
      })
    );
    callback(arenas);
  });
}

export async function getArena(arenaId: string): Promise<{ id: string; name: string; active: boolean } | null> {
  const ref = doc(db, "arenas", arenaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as { name?: string; active?: boolean };
  return {
    id: snap.id,
    name: data.name ?? "Arena",
    active: data.active ?? false
  };
}

export function listenToArenaPresence(
  arenaId: string,
  callback: (presence: ArenaPresence[]) => void
): () => void {
  const presenceRef = query(collection(db, `arenas/${arenaId}/presence`), orderBy("joinedAt", "asc"));
  return onSnapshot(presenceRef, (snapshot) => {
    const presence = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as { playerName?: string; joinedAt?: unknown };
      return {
        playerId: docSnap.id,
        playerName: data.playerName ?? "Unknown",
        joinedAt: data.joinedAt
      };
    });
    callback(presence);
  });
}
