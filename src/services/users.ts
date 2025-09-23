import { doc, getDoc, serverTimestamp, setDoc, type DocumentSnapshot } from "firebase/firestore";
import { getApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

let cachedAuth: Auth | null = null;
let cachedDisplayName: { uid: string; value: string } | null = null;

const getAuthSingleton = (): Auth | null => {
  if (cachedAuth) return cachedAuth;
  try {
    const app = getApp();
    cachedAuth = getAuth(app);
    return cachedAuth;
  } catch (error) {
    try {
      cachedAuth = getAuth();
      return cachedAuth;
    } catch (err) {
      console.warn("[USERS] auth-unavailable", err);
      return null;
    }
  }
};

const normalizeName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const fallbackDisplayName = (uid: string): string => {
  const tail = uid.slice(-4) || "0000";
  return `Player ${tail}`;
};

export async function getDisplayName(db: Firestore): Promise<string> {
  const auth = getAuthSingleton();
  const user = auth?.currentUser;
  const uid = user?.uid;
  if (!uid) {
    return "Guest";
  }

  if (cachedDisplayName?.uid === uid) {
    return cachedDisplayName.value;
  }

  const authDisplayName = normalizeName(user.displayName);
  const ref = doc(db, "users", uid);
  let snapshot: DocumentSnapshot<Record<string, unknown>> | null = null;
  try {
    snapshot = await getDoc(ref);
  } catch (error) {
    console.warn("[USERS] profile-read-failed", error);
  }

  let profileDisplayName: string | null = null;
  const data = snapshot?.data();
  if (data) {
    profileDisplayName =
      normalizeName((data as { profile?: { displayName?: unknown }; displayName?: unknown })?.profile?.displayName) ??
      normalizeName((data as { profile?: { displayName?: unknown }; displayName?: unknown }).displayName);
  }

  const resolved = authDisplayName ?? profileDisplayName ?? fallbackDisplayName(uid);

  const writes: Promise<unknown>[] = [];
  if (authDisplayName && authDisplayName !== profileDisplayName) {
    writes.push(
      setDoc(
        ref,
        { profile: { displayName: authDisplayName }, displayName: authDisplayName, updatedAt: serverTimestamp() },
        { merge: true },
      ).catch((error) => {
        console.warn("[USERS] profile-sync-failed", error);
      }),
    );
  } else {
    const exists = snapshot?.exists() ?? false;
    if (!exists || !profileDisplayName) {
      const payload: Record<string, unknown> = {
        profile: { displayName: resolved },
        displayName: resolved,
      };
      if (!exists) {
        payload.createdAt = serverTimestamp();
      }
      writes.push(
        setDoc(ref, payload, { merge: true }).catch((error) => {
          console.warn("[USERS] profile-bootstrap-failed", error);
        }),
      );
    }
  }

  if (writes.length) {
    try {
      await Promise.all(writes);
    } catch {
      // handled in catch callbacks
    }
  }

  cachedDisplayName = { uid, value: resolved };
  return resolved;
}

export function clearCachedDisplayName() {
  cachedDisplayName = null;
}
