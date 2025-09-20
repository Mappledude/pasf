import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
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
  deleteDoc,
  collection,
  serverTimestamp,
  query,
  where,
  orderBy,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

// === CONFIG (stickfightpa) ===
export const firebaseConfig = {
  apiKey: "AIzaSyAfqKN-zpIpwblhcafgKEneUnAfcTUV0-A",
  authDomain: "stickfightpa.firebaseapp.com",
  projectId: "stickfightpa",
  storageBucket: "stickfightpa.firebasestorage.app",
  messagingSenderId: "116175306919",
  appId: "1:116175306919:web:2e483bbc453498e8f3db82",
};

// === SINGLETONS ===
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// === DEV EMULATORS (optional) ===
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

// === AUTH HELPERS ===
export async function ensureAnonAuth(): Promise<User> {
  if (!auth.currentUser) {
    const cred = await signInAnonymously(auth);
    return cred.user;
  }
  return auth.currentUser;
}

export function onAuth(cb: (uid: string | null) => void): () => void {
  return onAuthStateChanged(auth, (u) => cb(u?.uid ?? null));
}

// === TYPES ===
type ISODate = string;

export interface BossProfile {
  id: string;
  displayName: string;
  createdAt: ISODate;
}

export interface PlayerProfile {
  id: string;
  codename: string;
  passcode?: string;
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

export interface ArenaPresenceEntry {
  playerId: string;
  codename: string;
  joinedAt?: ISODate;
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

// === BOSS ===
export const ensureBossProfile = async (displayName: string) => {
  const ref = doc(db, "boss", "primary");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const profile: BossProfile = {
      id: "primary",
      displayName,
      createdAt: new Date().toISOString(),
    };
    await setDoc(ref, profile);
  }
  const again = await getDoc(ref);
  return again.data() as BossProfile | undefined;
};

// === PLAYERS + PASSCODES ===
export interface CreatePlayerInput {
  codename: string;
  passcode: string;
}

export const createPlayer = async (input: CreatePlayerInput) => {
  const playersRef = collection(db, "players");
  const now = serverTimestamp();
  const pRef = await addDoc(playersRef, {
    codename: input.codename,
    passcode: input.passcode,
    createdAt: now,
  });
  await setDoc(doc(db, "passcodes", input.passcode), {
    playerId: pRef.id,
    createdAt: now,
  });
  return pRef.id;
};

export const findPlayerByPasscode = async (passcode: string) => {
  const pc = await getDoc(doc(db, "passcodes", passcode));
  if (pc.exists()) {
    const playerId = (pc.data() as any).playerId as string;
    const pSnap = await getDoc(doc(db, "players", playerId));
    if (pSnap.exists()) {
      const d = pSnap.data() as any;
      return {
        id: pSnap.id,
        codename: d.codename,
        passcode: d.passcode,
        createdAt: d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
        lastActiveAt: d.lastActiveAt?.toDate?.().toISOString?.(),
      } as PlayerProfile;
    }
  }
  const q = query(collection(db, "players"), where("passcode", "==", passcode));
  const res = await getDocs(q);
  if (!res.empty) {
    const s = res.docs[0];
    const d = s.data() as any;
    return {
      id: s.id,
      codename: d.codename,
      passcode: d.passcode,
      createdAt: d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
      lastActiveAt: d.lastActiveAt?.toDate?.().toISOString?.(),
    } as PlayerProfile;
  }
  return undefined;
};

export const listPlayers = async (): Promise<PlayerProfile[]> => {
  const snapshot = await getDocs(collection(db, "players"));
  return snapshot.docs.map((s) => {
    const d = s.data() as any;
    return {
      id: s.id,
      codename: d.codename,
      passcode: d.passcode,
      createdAt: d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
      lastActiveAt: d.lastActiveAt?.toDate?.().toISOString?.(),
    } as PlayerProfile;
  });
};

export const updatePlayerActivity = async (playerId: string) => {
  await updateDoc(doc(db, "players", playerId), { lastActiveAt: serverTimestamp() });
};

// === ARENAS ===
export interface CreateArenaInput {
  name: string;
  description?: string;
  capacity?: number;
}

export const createArena = async (input: CreateArenaInput) => {
  const arenasRef = collection(db, "arenas");
  const now = serverTimestamp();
  const aRef = await addDoc(arenasRef, {
    name: input.name,
    description: input.description ?? "",
    capacity: input.capacity ?? null,
    isActive: true,
    createdAt: now,
  });
  return aRef.id;
};

export const listArenas = async (): Promise<Arena[]> => {
  const snapshot = await getDocs(collection(db, "arenas"));
  return snapshot.docs.map((s) => {
    const d = s.data() as any;
    return {
      id: s.id,
      name: d.name,
      description: d.description ?? undefined,
      capacity: d.capacity ?? undefined,
      isActive: !!d.isActive,
      createdAt: d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
    } as Arena;
  });
};

export const getArena = async (arenaId: string): Promise<Arena | null> => {
  const snapshot = await getDoc(doc(db, "arenas", arenaId));
  if (!snapshot.exists()) return null;
  const d = snapshot.data() as any;
  return {
    id: snapshot.id,
    name: d.name,
    description: d.description ?? undefined,
    capacity: d.capacity ?? undefined,
    isActive: !!d.isActive,
    createdAt: d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
  } as Arena;
};

export const joinArena = async (arenaId: string, playerId: string, codename: string) => {
  await setDoc(doc(db, `arenas/${arenaId}/presence/${playerId}`), {
    codename,
    joinedAt: serverTimestamp(),
  });
};

export const leaveArena = async (arenaId: string, playerId: string) => {
  await deleteDoc(doc(db, `arenas/${arenaId}/presence/${playerId}`));
};

export const watchArenaPresence = (
  arenaId: string,
  cb: (players: ArenaPresenceEntry[]) => void,
): Unsubscribe => {
  const presenceRef = query(
    collection(db, `arenas/${arenaId}/presence`),
    orderBy("joinedAt", "asc"),
  );
  return onSnapshot(presenceRef, (snapshot) => {
    const players = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as any;
      return {
        playerId: docSnap.id,
        codename: data.codename ?? "Agent",
        joinedAt: data.joinedAt?.toDate?.().toISOString?.(),
      } as ArenaPresenceEntry;
    });
    cb(players);
  });
};

// === LEADERBOARD ===
export interface UpsertLeaderboardInput {
  playerId: string;
  wins?: number;
  losses?: number;
  streak?: number;
}

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
  const snapshot = await getDocs(collection(db, "leaderboard"));
  return Promise.all(
    snapshot.docs.map(async (s) => {
      const d = s.data() as any;
      let playerCodename: string | undefined;
      try {
        const p = await getDoc(doc(db, "players", d.playerId));
        playerCodename = p.data()?.codename;
      } catch {}
      return {
        id: s.id,
        playerId: d.playerId,
        playerCodename,
        wins: d.wins ?? 0,
        losses: d.losses ?? 0,
        streak: d.streak ?? 0,
        updatedAt: d.updatedAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
      } as LeaderboardEntry;
    }),
  );
};
