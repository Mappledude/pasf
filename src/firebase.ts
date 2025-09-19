// src/firebase.ts
// Firebase bootstrap + helpers used across React pages/contexts

import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  connectAuthEmulator,
  User
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
  where
} from "firebase/firestore";

// ---- Config (stickfightpa) ----
const firebaseConfig = {
  apiKey: "AIzaSyAfqKN-zpIpwblhcafgKEneUnAfcTUV0-A",
  authDomain: "stickfightpa.firebaseapp.com",
  projectId: "stickfightpa",
  storageBucket: "stickfightpa.firebasestorage.app",
  messagingSenderId: "116175306919",
  appId: "1:116175306919:web:2e483bbc453498e8f3db82"
};

// ---- App singletons ----
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ---- Optional emulator hook (used in dev by some pages) ----
export const maybeConnectEmulators = () => {
  // Only connect in dev if explicitly requested
  // Add VITE_USE_FIREBASE_EMULATORS=true to .env if you want this path
  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099");
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
      // eslint-disable-next-line no-console
      console.info("[firebase] connected to emulators");
    } catch (e) {
      console.warn("[firebase] emulator connect skipped:", e);
    }
  }
};

// ---- Auth helpers ----
export async function ensureAnonAuth(): Promise<User> {
  if (!auth.currentUser) {
    const cred = await signInAnonymously(auth);
    return cred.user;
  }
  return auth.currentUser!;
}

export const signInAnonymouslyWithTracking = async () => {
  const cred = await signInAnonymously(auth);
  return cred.user;
};

export function onAuth(cb: (uid: string | null) => void): void {
  onAuthStateChanged(auth, (u) => cb(u?.uid ?? null));
}

// ---- Types (lightweight) ----
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

// ---- Boss profile (placeholder single-boss model) ----
export const ensureBossProfile = async (displayName: string) => {
  const ref = doc(db, "boss", "primary");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const profile: BossProfile = {
      id: "primary",
      displayName,
      createdAt: new Date().toISOString()
    };
    await setDoc(ref, profile);
  }
  const again = await getDoc(ref);
  return again.data() as BossProfile | undefined;
};

// ---- Players ----
export interface CreatePlayerInput {
  codename: string;
  passcode: string;
  preferredArenaId?: string;
}

// Create a player with a passcode (MVP: plaintext; will secure later)
export const createPlayer = async (input: CreatePlayerInput) => {
  const playersRef = collection(db, "players");
  const now = serverTimestamp();
  const docRef = await addDoc(playersRef, {
    codename: input.codename,
    passcode: input.passcode,
    preferredArenaId: input.preferredArenaId ?? null,
    createdAt: now
  });
  // Create passcode mapping for O(1) lookup (doc id is the passcode)
  await setDoc(doc(db, "passcodes", input.passcode), {
    playerId: docRef.id,
    createdAt: now
  });
  return docRef.id;
};

// Find player via passcode (either mapping or players query)
export const findPlayerByPasscode = async (passcode: string) => {
  // Preferred path: passcodes/{passcode} → playerId
  const pc = await getDoc(doc(db, "passcodes", passcode));
  if (pc.exists()) {
    const playerId = (pc.data() as any).playerId as string;
    const pSnap = await getDoc(doc(db, "players", playerId));
    if (pSnap.exists()) {
      const d = pSnap.data() as any;
      const profile: PlayerProfile = {
        id: pSnap.id,
        codename: d.codename,
        preferredArenaId: d.preferredArenaId ?? undefined,
        createdAt: d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
        lastActiveAt: d.lastActiveAt?.toDate?.().toISOString?.()
      };
      return profile;
    }
  }
  // Fallback: query players by passcode field (dev only)
  const q = query(collection(db, "players"), where("passcode", "==", passcode));
  const res = await getDocs(q);
  if (!res.empty) {
    const docSnap = res.docs[0];
    const d = docSnap.data() as any;
    const profile: PlayerProfile = {
      id: docSnap.id,
      codename: d.codename,
      preferredArenaId: d.preferredArenaId ?? undefined,
      createdAt: d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
      lastActiveAt: d.lastActiveAt?.toDate?.().toISOString?.()
    };
    return profile;
  }
  return undefined;
};

export const updatePlayerActivity = async (playerId: string) => {
  const ref = doc(db, "players", playerId);
  await updateDoc(ref, { lastActiveAt: serverTimestamp() });
};

// ---- Arenas ----
export interface CreateArenaInput {
  name: string;
  description?: string;
  capacity?: number;
}

export const createArena = async (input: CreateArenaInput) => {
  const arenasRef = collection(db, "arenas");
  const now = serverTimestamp();
  const docRef = await addDoc(arenasRef, {
    name: input.name,
    description: input.description ?? "",
    capacity: input.capacity ?? null,
    isActive: true,
    createdAt: now
  });
  return docRef.id;
};

export const listArenas = async () => {
  const arenasRef = collection(db, "arenas");
  const snapshot = await getDocs(arenasRef);
  const arenas: Arena[] = snapshot.docs.map((s) => {
    const d = s.data() as any;
    return {
      id: s.id,
      name: d.name,
      description: d.description ?? undefined,
      capacity: d.capacity ?? undefined,
      isActive: Boolean(d.isActive),
      createdAt: d.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString()
    };
  });
  return arenas;
};

// ---- Leaderboard (simple totals; optional) ----
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
      updatedAt: now
    });
    return;
  }
  const cur = snap.data() as any;
  await updateDoc(ref, {
    wins: input.wins ?? cur.wins ?? 0,
    losses: input.losses ?? cur.losses ?? 0,
    streak: input.streak ?? cur.streak ?? 0,
    updatedAt: now
  });
};

export const listLeaderboard = async () => {
  const snapshot = await getDocs(collection(db, "leaderboard"));
  const entries: LeaderboardEntry[] = await Promise.all(
    snapshot.docs.map(async (s) => {
      const d = s.data() as any;
      let playerCodename: string | undefined;
      try {
        const p = await getDoc(doc(db, "players", d.playerId));
        playerCodename = p.data()?.codename;
      } catch (e) {
        // ignore resolution failure
      }
      return {
        id: s.id,
        playerId: d.playerId,
        playerCodename,
        wins: d.wins ?? 0,
        losses: d.losses ?? 0,
        streak: d.streak ?? 0,
        updatedAt: d.updatedAt?.toDate?.().toISOString?.() ?? new Date().toISOString()
      };
    })
  );
  return entries;
};
