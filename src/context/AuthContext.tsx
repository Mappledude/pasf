import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ensureAnonAuth,
  onAuth, // <-- wrapper that works with dev stub & real Firebase
  signInAnonymouslyWithTracking,
  findPlayerByPasscode,
  updatePlayerActivity,
  maybeConnectEmulators,
} from "../firebase";
import type { PlayerProfile } from "../types/models";

// Keep user simple so it works with both the dev stub ({ uid: string }) and real Firebase
type AnyUser = { uid: string } | null;

interface AuthContextValue {
  user: AnyUser;
  player: PlayerProfile | null;
  loading: boolean;
  login: (passcode: string) => Promise<PlayerProfile>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AnyUser>(null);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    maybeConnectEmulators();

    // Make sure we have *some* anon session (dev stub or real)
    ensureAnonAuth().catch((e) => console.warn("ensureAnonAuth failed (dev ok):", e));

    // Subscribe via wrapper (returns uid or null)
    const unsubscribe = onAuth((uid) => {
      setUser(uid ? { uid } : null);
      if (!uid) setPlayer(null);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = useCallback(async (passcode: string) => {
    setLoading(true);

    // Ensure a session; normalize uid from either stub or real Firebase
    const cred = await signInAnonymouslyWithTracking().catch(() => null);
    const uid =
      (cred as any)?.uid ??
      (cred as any)?.user?.uid ??
      user?.uid ??
      "dev-anon";
    setUser({ uid });

    const trimmed = passcode.trim();
    const playerProfile = await findPlayerByPasscode(trimmed);
    if (!playerProfile) {
      setLoading(false);
      throw new Error("Invalid passcode. Ask the Boss for access.");
    }

    await updatePlayerActivity(playerProfile.id).catch(() => {});
    setPlayer(playerProfile);
    setLoading(false);
    return playerProfile;
  }, [user]);

  const logout = useCallback(async () => {
    // No direct SDK call here so it works with the dev stub too
    setPlayer(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, player, loading, login, logout }),
    [user, player, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
};
