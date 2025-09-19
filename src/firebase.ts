import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  connectAuthEmulator,
  type User,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  getDocs,
  collection,
  serverTimestamp,
  query,
  where,
} from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyAfqKN-zpIpwblhcafgKEneUnAfcTUV0-A",
  authDomain: "stickfightpa.firebaseapp.com",
  projectId: "stickfightpa",
  storageBucket: "stickfightpa.firebasestorage.app",
  messagingSenderId: "116175306919",
  appId: "1:116175306919:web:2e483bbc453498e8f3db82",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Dev emulator hook (no-op unless explicitly enabled)
export const maybeConnectEmulators = () => {
  if (import.meta.env?.DEV && import.meta.env?.VITE_USE_FIREBASE_EMULATORS === "true") {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099");
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
      console.info("[firebase] emulators connected");
    } catch (e) {
      console.warn("[firebase] emulator connect skipped:", e);
    }
  }
};

export async function ensureAnonAuth(): Promise<User> {
  if (!auth.currentUser) {
    const cred = await signInAnonymously(auth);
    return cred.user;
  }
  return auth.currentUser!;
}
export function onAuth(cb: (uid: string | null) => void): void {
  onAuthStateChanged(auth, (u) => cb(u?.uid ?? null));
}
export const signInAnonymouslyWithTracking = async (): Promise<User> => {
  const cred = await signInAnonymously(auth);
  return cred.user;
};

type ISODate = string;
export interface BossProfile { id: string; displayName: string; createdAt: ISODate; }
export interface PlayerProfile {
  id: string;
  codename: string;
  passcode?: string;
  preferredArenaId?: string;
  createdAt: ISODate;
  lastActiveAt?: ISODate;
}
export interface Arena {
  id: string;
  name: string;
  description?: string;
  capacity?: number | null;
  isActive: boolean;
  createdAt: ISODate;
}
export interface LeaderboardEntry {
  id: string;
  playerId: string;
  playerCodename?: string;
  wins: number;
  losses: number;
  streak: number;
  updatedAt: ISODate;
}

// Boss profile
export const ensureBossProfile = async (displayName: string) => {
  const ref = doc(db, "boss", "primary");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const profile: BossProfile = { id: "primary", displayName, createdAt: new Date().toISOString() };
    await setDoc(ref, profile);
  }
  const again = await getDoc(ref);
  return again.data() as BossProfile | undefined;
};

// Players & passcodes
export interface CreatePlayerInput { codename: string; passcode: string; preferredArenaId?: string; }

export const createPlayer = async (input: CreatePlayerInput) => {
  const now = serverTimestamp();
  const pRef = await addDoc(collection(db, "players"), {
    codename: input.codename,
    passcode: input.passcode,
    preferredArenaId: input.preferredArenaId ?? null,
    createdAt: now,
  });
  await setDoc(doc(db, "passcodes", input.passcode), { playerId: pRef.id, createdAt: now });
  return pRef.id;
};

export const findPlayerByPasscode = async (passcode: string) => {
  const mapSnap = await getDoc(doc(db, "passcodes", passcode));
  if (mapSnap.exists()) {
    const playerId = (mapSnap.data() as any).playerId as string;
    const p = await getDoc(doc(db, "players", playerId));
    if (p.exists()) {
      const d = p.data() as any;
      const createdAt = d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString();
      const lastActiveAt = d.lastActiveAt?.toDate?.().toISOString?.();
      return { id: p.id, codename: d.codename, preferredArenaId: d.preferredArenaId ?? undefined, createdAt, lastActiveAt } as PlayerProfile;
    }
  }
  const qy = query(collection(db, "players"), where("passcode", "==", passcode));
  const res = await getDocs(qy);
  if (!res.empty) {
    const s = res.docs[0];
    const d = s.data() as any;
    const createdAt = d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString();
    const lastActiveAt = d.lastActiveAt?.toDate?.().toISOString?.();
    return { id: s.id, codename: d.codename, preferredArenaId: d.preferredArenaId ?? undefined, createdAt, lastActiveAt } as PlayerProfile;
  }
  return undefined;
};

export const updatePlayerActivity = async (playerId: string) => {
  await updateDoc(doc(db, "players", playerId), { lastActiveAt: serverTimestamp() });
};

// Arenas
export interface CreateArenaInput { name: string; description?: string; capacity?: number; }

export const createArena = async (input: CreateArenaInput) => {
  const now = serverTimestamp();
  const aRef = await addDoc(collection(db, "arenas"), {
    name: input.name,
    description: input.description ?? "",
    capacity: input.capacity ?? null,
    isActive: true,
    createdAt: now,
  });
  return aRef.id;
};

export const listArenas = async (): Promise<Arena[]> => {
  const snap = await getDocs(collection(db, "arenas"));
  return snap.docs.map((s) => {
    const d = s.data() as any;
    const createdAt = d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString();
    return {
      id: s.id,
      name: d.name,
      description: d.description ?? undefined,
      capacity: d.capacity ?? undefined,
      isActive: !!d.isActive,
      createdAt,
    } as Arena;
  });
};

// Leaderboard
export interface UpsertLeaderboardInput { playerId: string; wins?: number; losses?: number; streak?: number; }

export const upsertLeaderboardEntry = async (input: UpsertLeaderboardInput) => {
  const ref = doc(db, "leaderboard", input.playerId);
  const snap = await getDoc(ref);
  const now = serverTimestamp();
  if (!snap.exists()) {
    await setDoc(ref, {
      playerId: input.playerId,
      wins: input.wins ?? 0,
      losses: input.losses ?? 0,
      streak: input.streak ?? 0,
      updatedAt: now,
    });
    return;
  }
  const cur = snap.data() as any;
  await updateDoc(ref, {
    wins: input.wins ?? cur.wins ?? 0,
    losses: input.losses ?? cur.losses ?? 0,
    streak: input.streak ?? cur.streak ?? 0,
    updatedAt: now,
  });
};

export const listLeaderboard = async (): Promise<LeaderboardEntry[]> => {
  const snap = await getDocs(collection(db, "leaderboard"));
  return Promise.all(
    snap.docs.map(async (s) => {
      const d = s.data() as any;
      let playerCodename: string | undefined;
      try {
        const p = await getDoc(doc(db, "players", d.playerId));
        playerCodename = p.data()?.codename;
      } catch {}
      const updatedAt = d.updatedAt?.toDate?.().toISOString?.() ?? new Date().toISOString();
      return {
        id: s.id,
        playerId: d.playerId,
        playerCodename,
        wins: d.wins ?? 0,
        losses: d.losses ?? 0,
        streak: d.streak ?? 0,
        updatedAt,
      } as LeaderboardEntry;
    })
  );
};

// END
