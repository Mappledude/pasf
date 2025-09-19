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

// === DEV EMULATORS (optional, guarded by env) ===
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
  return auth.currentUser!;
}
export function onAuth(cb: (uid: string | null) => void): void {
  onAuthStateChanged(auth, (u) => cb(u?.uid ?? null));
}
export const signInAnonymouslyWithTracking = async (): Promise<User> => {
  const cred = await signInAnonymously(auth);
  return cred.user;
};

// === APP TYPES ===
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

// === BOSS PROFILE ===
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

// === PLAYERS & PASSCODES ===
export interface CreatePlayerInput { codename: string; passcode: string; preferredArenaId?: string; }

export const createPlayer = async (input: CreatePlayerInput) => {
  const now = serverTimestamp();
  const pRef = await addDoc(collection(db, "players"), {
    codename: input.codename,
    passcode: input.passcode,
    preferredArenaId: input.preferredArenaId ?? null,
    createdAt: now,
  });
  // passcode → playerId mapping for quick lookup
  await setDoc(doc(db, "passcodes", input.passcode), { playerId: pRef.id, createdAt: now });
  return pRef.id;
};

export const findPlayerByPasscode = async (passcode: string) => {
  // Fast path: mapping collection
  const mapSnap = await getDoc(doc(db, "passcodes", passcode));
  if
