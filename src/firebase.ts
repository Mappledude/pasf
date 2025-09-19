//
// 🚨 TEMP DEV STUB: This file is a minimal no-backend, in-memory implementation
// that exports ALL the names the app imports so Vite can start.
// Use only for local dev to get /training working. Replace with real Firebase
// implementation once your exports mismatch is resolved.
//

import type { Auth, User as FirebaseUser } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { Arena, BossProfile, LeaderboardEntry, PlayerProfile } from "./types/models";

// Pretend config (kept just to satisfy imports elsewhere if inspected)
export const firebaseConfig = {
  apiKey: "dev-stub",
  authDomain: "dev-stub",
  projectId: "dev-stub",
  storageBucket: "dev-stub",
  messagingSenderId: "dev-stub",
  appId: "dev-stub",
};

// Minimal "singletons"
const fakeUser = { uid: "dev-anon" } as unknown as FirebaseUser;
export const app = { name: "dev-stub-app" } as const;
export const auth = { currentUser: fakeUser } as unknown as Auth;
export const db = { name: "dev-stub-db" } as unknown as Firestore;

// Flags
export const USING_DEV_STUB = true;

// No-op emulator hook
export const maybeConnectEmulators = () => {
  console.info("[firebase DEV STUB] maybeConnectEmulators()");
};

// Auth helpers
export type User = FirebaseUser;
export async function ensureAnonAuth(): Promise<User> {
  return fakeUser;
}
export function onAuth(cb: (uid: string | null) => void): void {
  // Immediately call back with a fake user
  queueMicrotask(() => cb(fakeUser.uid));
}
export const signInAnonymouslyWithTracking = async (): Promise<User> => {
  return fakeUser;
};

// In-memory stores (dev only)
const memory = {
  boss: { id: "primary", displayName: "Boss", createdAt: new Date().toISOString() } as BossProfile,
  players: new Map<string, PlayerProfile>(),
  passcodes: new Map<string, string>(), // passcode -> playerId
  arenas: new Map<string, Arena>(),
  leaderboard: new Map<string, LeaderboardEntry>(),
};

// Boss
export const ensureBossProfile = async (displayName: string) => {
  memory.boss.displayName = displayName || memory.boss.displayName;
  return memory.boss;
};

// Players & passcodes
export interface CreatePlayerInput {
  codename: string;
  passcode: string;
  preferredArenaId?: string;
}

export const createPlayer = async (input: CreatePlayerInput) => {
  const id = "dev-player-" + Math.random().toString(36).slice(2, 9);
  const createdAt = new Date().toISOString();
  const p: PlayerProfile = {
    id,
    codename: input.codename,
    passcode: input.passcode,
    preferredArenaId: input.preferredArenaId,
    createdAt,
  };
  memory.players.set(id, p);
  memory.passcodes.set(input.passcode, id);
  return id;
};

export const findPlayerByPasscode = async (passcode: string) => {
  const id = memory.passcodes.get(passcode);
  if (!id) return undefined;
  return memory.players.get(id);
};

export const updatePlayerActivity = async (playerId: string) => {
  const p = memory.players.get(playerId);
  if (p) p.lastActiveAt = new Date().toISOString();
};

// Arenas
export interface CreateArenaInput {
  name: string;
  description?: string;
  capacity?: number;
}

export const createArena = async (input: CreateArenaInput) => {
  const id = "dev-arena-" + Math.random().toString(36).slice(2, 9);
  const a: Arena = {
    id,
    name: input.name,
    description: input.description ?? "",
    capacity: input.capacity,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  memory.arenas.set(id, a);
  return id;
};

export const listArenas = async (): Promise<Arena[]> => {
  return Array.from(memory.arenas.values());
};

// Leaderboard
export interface UpsertLeaderboardInput {
  playerId: string;
  wins?: number;
  losses?: number;
  streak?: number;
}

export const upsertLeaderboardEntry = async (input: UpsertLeaderboardInput) => {
  const cur = memory.leaderboard.get(input.playerId);
  if (!cur) {
    memory.leaderboard.set(input.playerId, {
      id: input.playerId,
      playerId: input.playerId,
      wins: input.wins ?? 0,
      losses: input.losses ?? 0,
      streak: input.streak ?? 0,
      updatedAt: new Date().toISOString(),
    });
  } else {
    cur.wins = input.wins ?? cur.wins;
    cur.losses = input.losses ?? cur.losses;
    cur.streak = input.streak ?? cur.streak;
    cur.updatedAt = new Date().toISOString();
    memory.leaderboard.set(input.playerId, cur);
  }
};

export const listLeaderboard = async (): Promise<LeaderboardEntry[]> => {
  return Array.from(memory.leaderboard.values());
};

// --- END DEV STUB ---
