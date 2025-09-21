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
  runTransaction,
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

export type ArenaPlayerState = {
  codename: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: "L" | "R";
  anim?: string;
  hp: number;
};

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

export const normalizePasscode = (passcode: string) => passcode.trim().toLowerCase();

export const createPlayer = async (input: CreatePlayerInput) => {
  await ensureAnonAuth();
  const playersRef = collection(db, "players");
  const now = serverTimestamp();
  const normalizedPasscode = normalizePasscode(input.passcode);
  const pRef = await addDoc(playersRef, {
    codename: input.codename,
    passcode: normalizedPasscode,
    createdAt: now,
  });
  await setDoc(doc(db, "passcodes", normalizedPasscode), {
    playerId: pRef.id,
    createdAt: now,
  });
  return pRef.id;
};

export const findPlayerByPasscode = async (passcode: string) => {
  const normalizedPasscode = normalizePasscode(passcode);
  const pc = await getDoc(doc(db, "passcodes", normalizedPasscode));
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
  const q = query(
    collection(db, "players"),
    where("passcode", "==", normalizedPasscode),
  );
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
  await ensureAnonAuth();
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

export const joinArena = async (
  arenaId: string,
  presenceId: string,
  codename: string,
  profileId?: string,
) => {
  const ref = doc(db, `arenas/${arenaId}/presence/${presenceId}`);
  const data: Record<string, unknown> = {
    playerId: presenceId,
    authUid: presenceId,
    codename,
    joinedAt: serverTimestamp(),
  };
  if (profileId) {
    data.profileId = profileId;
  }
  await setDoc(ref, data, { merge: true });
};

export const leaveArena = async (arenaId: string, presenceId: string) => {
  await deleteDoc(doc(db, `arenas/${arenaId}/presence/${presenceId}`));
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
        playerId: data.playerId ?? docSnap.id,
        codename: data.codename ?? "Agent",
        joinedAt: data.joinedAt?.toDate?.().toISOString?.(),
        authUid: data.authUid ?? docSnap.id,
        profileId: data.profileId,
      } as ArenaPresenceEntry;
    });
    cb(players);
  });
};

const arenaStateDoc = (arenaId: string) => doc(db, "arenas", arenaId, "state");

export async function initArenaPlayerState(
  arenaId: string,
  me: { id: string; codename: string },
  spawn: { x: number; y: number },
) {
  await ensureAnonAuth();
  const ref = arenaStateDoc(arenaId);
  await setDoc(
    ref,
    {
      tick: 0,
      players: {
        [me.id]: {
          codename: me.codename,
          x: spawn.x,
          y: spawn.y,
          vx: 0,
          vy: 0,
          facing: "R",
          hp: 100,
          updatedAt: serverTimestamp(),
        },
      },
      lastUpdate: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateArenaPlayerState(
  arenaId: string,
  meId: string,
  partial: Partial<ArenaPlayerState>,
) {
  await ensureAnonAuth();
  const ref = arenaStateDoc(arenaId);
  await setDoc(
    ref,
    {
      players: {
        [meId]: {
          ...partial,
          updatedAt: serverTimestamp(),
        },
      },
      lastUpdate: serverTimestamp(),
    },
    { merge: true },
  );
}

export function watchArenaState(arenaId: string, cb: (state: any) => void) {
  const ref = arenaStateDoc(arenaId);
  return onSnapshot(ref, (snap) => cb(snap.exists() ? snap.data() : undefined));
}

export async function applyDamage(arenaId: string, targetPlayerId: string, amount: number) {
  await ensureAnonAuth();
  const ref = arenaStateDoc(arenaId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const cur = data.players?.[targetPlayerId];
    if (!cur) return;
    const hp = Math.max(0, Math.min(100, (cur.hp ?? 100) - amount));
    tx.set(
      ref,
      {
        players: {
          [targetPlayerId]: { hp, updatedAt: serverTimestamp() },
        },
        lastUpdate: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function respawnPlayer(
  arenaId: string,
  meId: string,
  spawn: { x: number; y: number },
) {
  await updateArenaPlayerState(arenaId, meId, {
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    hp: 100,
    anim: undefined,
  });
}

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
