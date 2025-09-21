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
  orderBy,
  onSnapshot,
  runTransaction,
  type QueryDocumentSnapshot,
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

let loggedProjectId = false;

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
let pendingAnonAuth: Promise<User> | null = null;

export async function ensureAnonAuth(): Promise<User> {
  if (!loggedProjectId) {
    loggedProjectId = true;
    const projectId = app.options.projectId;
    if (projectId && projectId !== "stickfightpa") {
      console.warn(`[BOOT] projectId = ${projectId} (expected stickfightpa)`);
    } else {
      console.info(`[BOOT] projectId = ${projectId ?? "(unknown)"}`);
    }
  }

  if (auth.currentUser) {
    console.info(`[AUTH] ensureAnonAuth ok ${auth.currentUser.uid}`);
    return auth.currentUser;
  }

  if (pendingAnonAuth) {
    return pendingAnonAuth;
  }

  const waitForAuthUser = () =>
    new Promise<User>((resolve, reject) => {
      let unsubscribe: () => void = () => {};
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for anonymous auth"));
      }, 10_000);

      unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          if (!user) return;
          clearTimeout(timeout);
          unsubscribe();
          console.info(`[AUTH] ensureAnonAuth ok ${user.uid}`);
          resolve(user);
        },
        (error) => {
          clearTimeout(timeout);
          unsubscribe();
          reject(error);
        },
      );
    });

  pendingAnonAuth = (async () => {
    try {
      await signInAnonymously(auth);
      return await waitForAuthUser();
    } finally {
      pendingAnonAuth = null;
    }
  })();

  return pendingAnonAuth;
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

export interface ArenaSeatAssignment {
  seatNo: number;
  playerId: string;
  uid: string;
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

export interface ArenaInputSnapshot {
  playerId: string;
  codename?: string;
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
  updatedAt?: ISODate;
}

export interface ArenaStateWritePlayer {
  codename?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: "L" | "R";
  hp: number;
  anim?: string;
}

export interface ArenaStateWrite {
  tick: number;
  tMs: number;
  players: Record<string, ArenaStateWritePlayer>;
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

export const normalizePasscode = (passcode: string) => passcode.trim().toLowerCase();

export const createPlayer = async (input: CreatePlayerInput) => {
  await ensureAnonAuth();
  const now = serverTimestamp();
  const normalizedPasscode = normalizePasscode(input.passcode);
  const playersRef = collection(db, "players");
  const playerRef = doc(playersRef);
  await setDoc(playerRef, {
    codename: input.codename,
    createdAt: now,
    lastActiveAt: now,
  });
  await setDoc(doc(db, "passcodes", normalizedPasscode), {
    playerId: playerRef.id,
    createdAt: now,
  });
  return playerRef.id;
};

export const findPlayerByPasscode = async (
  raw: string
): Promise<PlayerProfile | undefined> => {
  await ensureAnonAuth();
  const code = normalizePasscode(raw);

  // Look up passcodes/{code} -> { playerId }
  const passSnap = await getDoc(doc(db, "passcodes", code));
  if (!passSnap.exists()) return undefined;

  const { playerId } = passSnap.data() as { playerId: string };
  const pSnap = await getDoc(doc(db, "players", playerId));
  if (!pSnap.exists()) return undefined;

  const d = pSnap.data() as any;
  return {
    id: pSnap.id,
    codename: d.codename,
    createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
    lastActiveAt: d.lastActiveAt?.toDate?.()?.toISOString?.(),
  } as PlayerProfile;
};

export const loginWithPasscode = async (passcode: string): Promise<PlayerProfile> => {
  const normalizedPasscode = normalizePasscode(passcode);
  console.info("[AUTH] loginWithPasscode start");
  await ensureAnonAuth();
  const passcodeSnap = await getDoc(doc(db, "passcodes", normalizedPasscode));
  if (!passcodeSnap.exists()) {
    throw new Error("Invalid passcode. Ask the Boss for access.");
  }

  const { playerId } = passcodeSnap.data() as { playerId?: string };
  if (!playerId) {
    throw new Error("Invalid passcode. Ask the Boss for access.");
  }

  const playerSnap = await getDoc(doc(db, "players", playerId));
  if (!playerSnap.exists()) {
    throw new Error("Invalid passcode. Ask the Boss for access.");
  }

  const { passcode: _ignoredPasscode, ...playerData } = playerSnap.data() ?? {};
  const profile = { id: playerSnap.id, ...playerData } as PlayerProfile;
  console.info(`[AUTH] loginWithPasscode ok ${profile.id}`);
  return profile;
};
export const listPlayers = async (): Promise<PlayerProfile[]> => {
  await ensureAnonAuth();
  const snapshot = await getDocs(collection(db, "players"));
  return snapshot.docs.map((docSnap) => {
    const d = docSnap.data() as any;
    return {
      id: docSnap.id,
      codename: d.codename,
      createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
      lastActiveAt: d.lastActiveAt?.toDate?.()?.toISOString?.(),
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
  try {
    const aRef = await addDoc(arenasRef, {
      name: input.name,
      description: input.description ?? "",
      capacity: input.capacity ?? null,
      isActive: true,
      createdAt: now,
    });
    console.info(`[STATE] createArena ${aRef.id} => lobby phase`);
    await setDoc(
      doc(db, "arenas", aRef.id, "state", "current"),
      {
        tick: 0,
        phase: "lobby",
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    return aRef.id;
  } catch (error) {
    console.error("[STATE] createArena failed", error);
    throw error;
  }
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

const seatDoc = (arenaId: string, seatNo: number) =>
  doc(db, `arenas/${arenaId}/seats/${seatNo}`);

const normalizeSeatPlayerId = (playerId: string | null | undefined, uid: string) =>
  playerId && playerId.trim().length > 0 ? playerId : uid;

export const claimArenaSeat = async (
  arenaId: string,
  seatNo: number,
  identity: { playerId?: string | null; uid: string },
) => {
  await ensureAnonAuth();
  const seatId = `${seatNo}`;
  const playerId = normalizeSeatPlayerId(identity.playerId, identity.uid);
  const seatRef = seatDoc(arenaId, seatNo);
  const seatsCollection = collection(db, `arenas/${arenaId}/seats`);
  const seatSnapshot = await getDocs(seatsCollection);
  const seatRefs = seatSnapshot.docs.map((snap) => snap.ref);

  await runTransaction(db, async (tx) => {
    const currentSnap = await tx.get(seatRef);
    if (currentSnap.exists()) {
      const data = currentSnap.data() as any;
      const alreadyMine =
        data?.uid === identity.uid || (playerId && data?.playerId === playerId);
      if (!alreadyMine) {
        throw new Error("Seat is already occupied.");
      }
    }

    for (const ref of seatRefs) {
      if (ref.id === seatId) continue;
      const otherSnap = await tx.get(ref);
      if (!otherSnap.exists()) continue;
      const data = otherSnap.data() as any;
      const matchesUid = data?.uid === identity.uid;
      const matchesPlayer = playerId && data?.playerId === playerId;
      if (matchesUid || matchesPlayer) {
        tx.delete(ref);
      }
    }

    tx.set(
      seatRef,
      {
        playerId,
        uid: identity.uid,
        joinedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
};

export const releaseArenaSeat = async (
  arenaId: string,
  seatNo: number,
  identity?: { playerId?: string | null; uid: string },
) => {
  await ensureAnonAuth();
  const seatRef = seatDoc(arenaId, seatNo);
  const playerId = identity ? normalizeSeatPlayerId(identity.playerId, identity.uid) : null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(seatRef);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    if (identity) {
      const matchesUid = data?.uid === identity.uid;
      const matchesPlayer = playerId && data?.playerId === playerId;
      if (!matchesUid && !matchesPlayer) {
        return;
      }
    }
    tx.delete(seatRef);
  });
};

export const watchArenaSeats = (
  arenaId: string,
  cb: (seats: ArenaSeatAssignment[]) => void,
): Unsubscribe => {
  const seatsRef = collection(db, `arenas/${arenaId}/seats`);
  return onSnapshot(seatsRef, (snapshot) => {
    const seats = snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as any;
        const seatNo = Number.parseInt(docSnap.id, 10);
        if (Number.isNaN(seatNo)) return null;
        return {
          seatNo,
          playerId: data?.playerId ?? "",
          uid: data?.uid ?? "",
          joinedAt: data?.joinedAt?.toDate?.().toISOString?.(),
        } as ArenaSeatAssignment;
      })
      .filter((seat): seat is ArenaSeatAssignment => !!seat)
      .sort((a, b) => a.seatNo - b.seatNo);
    cb(seats);
  });
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

const arenaStateDoc = (arenaId: string) =>
  doc(db, "arenas", arenaId, "state", "current");

const arenaInputDoc = (arenaId: string, playerId: string) =>
  doc(db, "arenas", arenaId, "inputs", playerId);

const arenaInputsCollection = (arenaId: string) =>
  collection(db, "arenas", arenaId, "inputs");

const readTimestamp = (value: unknown): ISODate | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const date = (value as { toDate?: () => Date }).toDate?.();
  return date?.toISOString();
};

const serializeInputSnapshot = (snap: QueryDocumentSnapshot): ArenaInputSnapshot => {
  const data = snap.data() as Record<string, unknown>;
  return {
    playerId: (data.playerId as string) ?? snap.id,
    codename: (data.codename as string) ?? undefined,
    left: typeof data.left === "boolean" ? data.left : undefined,
    right: typeof data.right === "boolean" ? data.right : undefined,
    jump: typeof data.jump === "boolean" ? data.jump : undefined,
    attack: typeof data.attack === "boolean" ? data.attack : undefined,
    updatedAt: readTimestamp(data.updatedAt),
  };
};

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
  options?: { tick?: number },
) {
  await ensureAnonAuth();
  const ref = arenaStateDoc(arenaId);
  const payload: Record<string, unknown> = {
    players: {
      [meId]: {
        ...partial,
        updatedAt: serverTimestamp(),
      },
    },
    lastUpdate: serverTimestamp(),
  };

  if (typeof options?.tick === "number") {
    payload.tick = options.tick;
  }

  await setDoc(ref, payload, { merge: true });
}

export function watchArenaState(arenaId: string, cb: (state: any) => void) {
  let unsubscribe: Unsubscribe | null = null;
  let cancelled = false;

  ensureAnonAuth()
    .then(() => {
      if (cancelled) return;
      const ref = arenaStateDoc(arenaId);
      unsubscribe = onSnapshot(ref, (snap) =>
        cb(snap.exists() ? snap.data() : undefined),
      );
      if (cancelled && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    })
    .catch((error) => {
      console.error("[firebase] watchArenaState failed to auth", error);
    });

  return () => {
    cancelled = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

export interface ArenaInputWrite {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
  codename?: string;
}

export async function writeArenaInput(
  arenaId: string,
  playerId: string,
  input: ArenaInputWrite,
): Promise<void> {
  await ensureAnonAuth();
  const ref = arenaInputDoc(arenaId, playerId);
  const payload: Record<string, unknown> = {
    playerId,
    updatedAt: serverTimestamp(),
  };
  if (typeof input.left === "boolean") payload.left = input.left;
  if (typeof input.right === "boolean") payload.right = input.right;
  if (typeof input.jump === "boolean") payload.jump = input.jump;
  if (typeof input.attack === "boolean") payload.attack = input.attack;
  if (input.codename) payload.codename = input.codename;
  await setDoc(ref, payload, { merge: true });
}

export async function fetchArenaInputs(arenaId: string): Promise<ArenaInputSnapshot[]> {
  await ensureAnonAuth();
  const snapshot = await getDocs(arenaInputsCollection(arenaId));
  return snapshot.docs.map(serializeInputSnapshot);
}

export function watchArenaInputs(
  arenaId: string,
  cb: (inputs: ArenaInputSnapshot[]) => void,
): Unsubscribe {
  const q = query(arenaInputsCollection(arenaId));
  return onSnapshot(q, (snapshot) => {
    cb(snapshot.docs.map(serializeInputSnapshot));
  });
}

export async function writeArenaState(arenaId: string, state: ArenaStateWrite): Promise<void> {
  await ensureAnonAuth();
  const ref = arenaStateDoc(arenaId);
  const players: Record<string, Record<string, unknown>> = {};
  for (const [playerId, data] of Object.entries(state.players)) {
    players[playerId] = {
      ...data,
      updatedAt: serverTimestamp(),
    };
  }
  await setDoc(
    ref,
    {
      tick: state.tick,
      tMs: state.tMs,
      players,
      lastUpdate: serverTimestamp(),
    },
    { merge: true },
  );
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
