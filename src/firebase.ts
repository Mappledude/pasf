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
  Timestamp,
  increment,
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

const FIREBASE_DEBUG = import.meta.env?.VITE_DEBUG_FIREBASE === "true" || import.meta.env?.DEV;

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
  displayName?: string | null;
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
  displayName?: string | null;
  joinedAt?: ISODate;
  authUid?: string;
  profileId?: string;
  lastSeen?: ISODate;
  expireAt?: ISODate;
}

export interface ArenaSeatAssignment {
  seatNo: number;
  playerId: string;
  uid: string;
  joinedAt?: ISODate;
  profileId?: string;
  codename?: string | null;
  displayName?: string | null;
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
  lastWinAt?: ISODate;
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
    displayName: typeof d.displayName === "string" && d.displayName.trim().length > 0
      ? d.displayName
      : typeof d.name === "string" && d.name.trim().length > 0
        ? d.name
        : null,
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
  const rawDisplayName =
    (playerData as { displayName?: string; name?: string }).displayName ??
    (playerData as { displayName?: string; name?: string }).name;
  profile.displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim().length > 0
      ? rawDisplayName
      : profile.displayName ?? null;
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
      displayName: typeof d.displayName === "string" && d.displayName.trim().length > 0
        ? d.displayName
        : typeof d.name === "string" && d.name.trim().length > 0
          ? d.name
          : null,
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
  displayName?: string | null,
) => {
  const ref = doc(db, `arenas/${arenaId}/presence/${presenceId}`);
  const trimmedDisplayName =
    typeof displayName === "string" && displayName.trim().length > 0 ? displayName.trim() : null;
  const playerId = profileId ?? presenceId;
  const baseData: Record<string, unknown> = {
    playerId,
    authUid: presenceId,
    arenaId,
    codename,
  };
  if (profileId) {
    baseData.profileId = profileId;
  }
  if (trimmedDisplayName) {
    baseData.displayName = trimmedDisplayName;
  }
  const heartbeatData = {
    lastSeen: serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + 45_000),
  };

  const logName = (trimmedDisplayName ?? codename ?? "Player").replace(/"/g, '\\"');

  const existing = await getDoc(ref);
  if (!existing.exists()) {
    console.info(
      `[PRESENCE] join name="${logName}" uid=${presenceId} arena=${arenaId} playerId=${playerId}`,
    );
    await setDoc(
      ref,
      {
        ...baseData,
        joinedAt: serverTimestamp(),
        ...heartbeatData,
      },
      { merge: false },
    );
    return;
  }

  console.info(
    `[PRESENCE] rejoin (preserving joinedAt) name="${logName}" uid=${presenceId} arena=${arenaId} playerId=${playerId}`,
  );
  await updateDoc(ref, {
    ...baseData,
    ...heartbeatData,
  });
};

export const heartbeatArenaPresence = async (
  arenaId: string,
  presenceId: string,
  codename: string,
  profileId?: string,
  displayName?: string | null,
) => {
  const ref = doc(db, `arenas/${arenaId}/presence/${presenceId}`);
  const trimmedDisplayName =
    typeof displayName === "string" && displayName.trim().length > 0 ? displayName.trim() : null;
  const playerId = profileId ?? presenceId;
  const data: Record<string, unknown> = {
    playerId,
    authUid: presenceId,
    arenaId,
    codename,
    lastSeen: serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + 45_000),
  };
  if (profileId) {
    data.profileId = profileId;
  }
  if (trimmedDisplayName) {
    data.displayName = trimmedDisplayName;
  }

  try {
    await updateDoc(ref, data);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "not-found") {
      console.info(
        `[PRESENCE] heartbeat recovery uid=${presenceId} arena=${arenaId} (presence missing, re-joining with fresh joinedAt)`,
      );
      await setDoc(ref, { ...data, joinedAt: serverTimestamp() });
      return;
    }
    throw error;
  }
};

export const leaveArena = async (arenaId: string, presenceId: string) => {
  await deleteDoc(doc(db, `arenas/${arenaId}/presence/${presenceId}`));
};

const seatDoc = (arenaId: string, seatNo: number) =>
  doc(db, `arenas/${arenaId}/seats/${seatNo}`);

const normalizeSeatPlayerId = (playerId: string | null | undefined, uid: string) =>
  playerId && playerId.trim().length > 0 ? playerId : uid;

type SeatIdentity = {
  playerId?: string | null;
  profileId?: string | null;
  uid: string;
  codename?: string | null;
  displayName?: string | null;
};

export const claimArenaSeat = async (
  arenaId: string,
  seatNo: number,
  identity: SeatIdentity,
) => {
  await ensureAnonAuth();
  const seatId = `${seatNo}`;
  const seatProfileId = identity.profileId ?? identity.playerId;
  const playerId = normalizeSeatPlayerId(seatProfileId, identity.uid);
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
        profileId: seatProfileId ?? null,
        codename: identity.codename ?? null,
        displayName: identity.displayName ?? null,
        joinedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
};

export const releaseArenaSeat = async (
  arenaId: string,
  seatNo: number,
  identity?: SeatIdentity,
) => {
  await ensureAnonAuth();
  const seatRef = seatDoc(arenaId, seatNo);
  const seatProfileId = identity?.profileId ?? identity?.playerId;
  const playerId = identity ? normalizeSeatPlayerId(seatProfileId, identity.uid) : null;

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
          profileId: data?.profileId ?? undefined,
          codename: data?.codename ?? undefined,
          displayName: data?.displayName ?? undefined,
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
      const displayName =
        typeof data.displayName === "string" && data.displayName.trim().length > 0
          ? data.displayName.trim()
          : undefined;
      return {
        playerId: data.playerId ?? docSnap.id,
        codename: data.codename ?? "Agent",
        displayName,
        joinedAt: data.joinedAt?.toDate?.().toISOString?.(),
        authUid: data.authUid ?? docSnap.id,
        profileId: data.profileId,
        lastSeen: data.lastSeen?.toDate?.().toISOString?.(),
        expireAt: data.expireAt?.toDate?.().toISOString?.(),
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

export async function deleteArenaInput(arenaId: string, playerId: string): Promise<void> {
  await ensureAnonAuth();
  const ref = arenaInputDoc(arenaId, playerId);
  await deleteDoc(ref);
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
  playerCodename?: string;
}

export const upsertLeaderboardEntry = async (input: UpsertLeaderboardInput) => {
  await ensureAnonAuth();
  const ref = doc(db, "leaderboard", input.playerId);
  const now = serverTimestamp();

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        playerId: input.playerId,
        wins: input.wins ?? 0,
        losses: input.losses ?? 0,
        streak: input.streak ?? 0,
        updatedAt: now,
      };
      if (input.playerCodename) {
        payload.playerCodename = input.playerCodename;
      }
      await setDoc(ref, payload);
      return;
    }

    const cur = snap.data() as any;
    const payload: Record<string, unknown> = {
      wins: input.wins ?? cur.wins ?? 0,
      losses: input.losses ?? cur.losses ?? 0,
      streak: input.streak ?? cur.streak ?? 0,
      updatedAt: now,
    };
    if (input.playerCodename) {
      payload.playerCodename = input.playerCodename;
    }
    await updateDoc(ref, payload);
  } catch (error) {
    if (FIREBASE_DEBUG) {
      console.error("[firebase] upsertLeaderboardEntry failed", error);
    }
    throw error;
  }
};

const deserializeLeaderboardEntry = (snap: QueryDocumentSnapshot): LeaderboardEntry => {
  const data = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    playerId: (data.playerId as string) ?? snap.id,
    playerCodename: typeof data.playerCodename === "string" ? data.playerCodename : undefined,
    wins: typeof data.wins === "number" ? data.wins : 0,
    losses: typeof data.losses === "number" ? data.losses : 0,
    streak: typeof data.streak === "number" ? data.streak : 0,
    updatedAt: readTimestamp(data.updatedAt) ?? new Date().toISOString(),
    lastWinAt: readTimestamp(data.lastWinAt),
  };
};

export interface RecordLeaderboardWinInput {
  playerId: string;
  codename?: string;
}

export async function recordLeaderboardWin(input: RecordLeaderboardWinInput): Promise<void> {
  await ensureAnonAuth();
  const ref = doc(db, "leaderboard", input.playerId);
  const payload: Record<string, unknown> = {
    playerId: input.playerId,
    wins: increment(1),
    streak: increment(1),
    lastWinAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.codename) {
    payload.playerCodename = input.codename;
  }
  try {
    await setDoc(ref, payload, { merge: true });
  } catch (error) {
    if (FIREBASE_DEBUG) {
      console.error("[firebase] recordLeaderboardWin failed", error);
    }
    throw error;
  }
}

export const listLeaderboard = async (): Promise<LeaderboardEntry[]> => {
  await ensureAnonAuth();
  const q = query(collection(db, "leaderboard"), orderBy("wins", "desc"), orderBy("lastWinAt", "desc"));
  const snapshot = await getDocs(q);
  const entries = snapshot.docs.map(deserializeLeaderboardEntry);

  return Promise.all(
    entries.map(async (entry) => {
      if (entry.playerCodename) {
        return entry;
      }
      try {
        const snap = await getDoc(doc(db, "players", entry.playerId));
        const codename = snap.data()?.codename;
        if (typeof codename === "string" && codename.trim().length > 0) {
          return { ...entry, playerCodename: codename };
        }
      } catch (error) {
        if (FIREBASE_DEBUG) {
          console.error("[firebase] listLeaderboard lookup failed", error);
        }
      }
      return entry;
    }),
  );
};

export function watchLeaderboard(
  cb: (entries: LeaderboardEntry[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  let unsubscribe: Unsubscribe | null = null;
  let cancelled = false;

  ensureAnonAuth()
    .then(() => {
      if (cancelled) return;
      const q = query(
        collection(db, "leaderboard"),
        orderBy("wins", "desc"),
        orderBy("lastWinAt", "desc"),
      );
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const entries = snapshot.docs.map(deserializeLeaderboardEntry);
          if (FIREBASE_DEBUG) {
            if (entries.length > 0) {
              console.log(`[LEADERBOARD] loaded count=${entries.length}`);
            } else {
              console.log("[LEADERBOARD] empty");
            }
          }
          cb(entries);
        },
        (error) => {
          if (FIREBASE_DEBUG) {
            console.error("[firebase] watchLeaderboard failed", error);
          }
          onError?.(error);
        },
      );
      if (cancelled && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    })
    .catch((error) => {
      if (FIREBASE_DEBUG) {
        console.error("[firebase] watchLeaderboard auth failed", error);
      }
      onError?.(error);
    });

  return () => {
    cancelled = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}
