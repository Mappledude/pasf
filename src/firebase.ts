// Firebase app bootstrap + minimal helpers (anon auth session)
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Inline config for stickfightpa (keeps this file self-contained)
const firebaseConfig = {
  apiKey: "AIzaSyAfqKN-zpIpwblhcafgKEneUnAfcTUV0-A",
  authDomain: "stickfightpa.firebaseapp.com",
  projectId: "stickfightpa",
  storageBucket: "stickfightpa.firebasestorage.app",
  messagingSenderId: "116175306919",
  appId: "1:116175306919:web:2e483bbc453498e8f3db82"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Ensure we always have an anonymous session before any Firestore work
export async function ensureAnonAuth(): Promise<void> {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

// Lightweight auth listener (optional convenience)
export function onAuth(cb: (uid: string | null) => void): void {
  onAuthStateChanged(auth, (u) => cb(u?.uid ?? null));
}
