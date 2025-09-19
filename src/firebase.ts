import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import type { Arena, BossProfile, LeaderboardEntry, PlayerProfile } from "./types/models";

export const firebaseConfig = {
  apiKey: "AIzaSyAfqKN-zpIpwblhcafgKEneUnAfcTUV0-A",
  authDomain: "stickfightpa.firebaseapp.com",
  projectId: "stickfightpa",
  storageBucket: "stickfightpa.firebasestorage.app",
  messagingSenderId: "116175306919",
  appId: "1:116175306919:web:2e483bbc453498e8f3db82",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export interface CreatePlayerInput {
  codename: string;
  passcode: string;
  preferredArenaId?: string;
}

export interface CreateArenaInput {
  name: string;
  description?: string;
  capacity?: number;
}

export interface UpsertLeaderboardInput {
  playerId: string;
  wins?: number;
  losses?: number;
  streak?: number;
}

export const ensureBossProfile = async (displayName: string) => {
  const bossDoc = doc(db, "boss", "primary");
  const snapshot = await getDoc(bossDoc);
  if (!snapshot.exists()) {
    const profile: BossProfile = {
      id: "primary",
      displayName,
      createdAt: new Date().toISOString(),
    };
    await setDoc(bossDoc, profile);
  }
  return (await getDoc(bossDoc)).data() as BossProfile | undefined;
};

export const createPlayer = async (input: CreatePlayerInput) => {
  const playersRef = collection(db, "players");
  const now = serverTimestamp();
  const docRef = await addDoc(playersRef, {
    codename: input.codename,
    passcode: input.passcode,
    preferredArenaId: input.preferredArenaId ?? null,
    createdAt: now,
  });
  return docRef.id;
};

export const updatePlayerActivity = async (playerId: string) => {
  const playerDoc = doc(db, "players", playerId);
  await updateDoc(playerDoc, {
    lastActiveAt: serverTimestamp(),
  });
};

export const findPlayerByPasscode = async (passcode: string) => {
  const playersRef = collection(db, "players");
  const q = query(playersRef, where("passcode", "==", passcode));
  const results = await getDocs(q);
  if (results.empty) {
    return undefined;
  }
  const docSnap = results.docs[0];
  const data = docSnap.data();
  const player: PlayerProfile = {
    id: docSnap.id,
    codename: data.codename,
    passcode: data.passcode,
    preferredArenaId: data.preferredArenaId ?? undefined,
    createdAt: data.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
    lastActiveAt: data.lastActiveAt?.toDate?.().toISOString?.(),
  };
  return player;
};

export const createArena = async (input: CreateArenaInput) => {
  const arenasRef = collection(db, "arenas");
  const now = serverTimestamp();
  const docRef = await addDoc(arenasRef, {
    name: input.name,
    description: input.description ?? "",
    capacity: input.capacity ?? null,
    isActive: true,
    createdAt: now,
  });
  return docRef.id;
};

export const listArenas = async () => {
  const arenasRef = collection(db, "arenas");
  const snapshot = await getDocs(arenasRef);
  const arenas: Arena[] = snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name,
      description: data.description ?? undefined,
      capacity: data.capacity ?? undefined,
      isActive: Boolean(data.isActive),
      createdAt: data.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
    } satisfies Arena;
  });
  return arenas;
};

export const upsertLeaderboardEntry = async (input: UpsertLeaderboardInput) => {
  const leaderboardDoc = doc(db, "leaderboard", input.playerId);
  const snapshot = await getDoc(leaderboardDoc);
  const now = serverTimestamp();
  if (!snapshot.exists()) {
    await setDoc(leaderboardDoc, {
      playerId: input.playerId,
      wins: input.wins ?? 0,
      losses: input.losses ?? 0,
      streak: input.streak ?? 0,
      updatedAt: now,
    });
    return;
  }
  await updateDoc(leaderboardDoc, {
    wins: input.wins ?? snapshot.data().wins ?? 0,
    losses: input.losses ?? snapshot.data().losses ?? 0,
    streak: input.streak ?? snapshot.data().streak ?? 0,
    updatedAt: now,
  });
};

export const listLeaderboard = async () => {
  const snapshot = await getDocs(collection(db, "leaderboard"));
  const entries: LeaderboardEntry[] = await Promise.all(
    snapshot.docs.map(async (docSnap) => {
      const data = docSnap.data();
      let playerCodename: string | undefined;
      try {
        const playerDoc = await getDoc(doc(db, "players", data.playerId));
        playerCodename = playerDoc.data()?.codename;
      } catch (error) {
        console.warn("Failed to resolve player profile for leaderboard", error);
      }
      return {
        id: docSnap.id,
        playerId: data.playerId,
        playerCodename,
        wins: data.wins ?? 0,
        losses: data.losses ?? 0,
        streak: data.streak ?? 0,
        updatedAt: data.updatedAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
      } satisfies LeaderboardEntry;
    }),
  );
  return entries;
};

export const signInAnonymouslyWithTracking = async () => {
  const credential = await signInAnonymously(auth);
  return credential.user;
};

export const maybeConnectEmulators = () => {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://localhost:9099");
    connectFirestoreEmulator(db, "localhost", 8080);
  }
};
