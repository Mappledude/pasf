import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  ensureAnonAuth,
  onAuth,
  findPlayerByPasscode,
  updatePlayerActivity,
  maybeConnectEmulators,
} from "../firebase";
import type { PlayerProfile } from "../types/models";

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
  const navigate = useNavigate();
  const [user, setUser] = useState<AnyUser>(null);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    maybeConnectEmulators();

    ensureAnonAuth().catch((e) => console.warn("ensureAnonAuth failed (dev ok):", e));

    const unsubscribe = onAuth((uid) => {
      setUser(uid ? { uid } : null);
      if (!uid) setPlayer(null);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = useCallback(
    async (passcode: string) => {
      setLoading(true);
      try {
        await ensureAnonAuth();
        const trimmed = passcode.trim();
        const playerProfile = await findPlayerByPasscode(trimmed);
        if (!playerProfile) {
          throw new Error("Invalid passcode. Ask the Boss for access.");
        }
        await updatePlayerActivity(playerProfile.id).catch(() => {});
        setPlayer(playerProfile);
        navigate("/");
        return playerProfile;
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  const logout = useCallback(async () => {
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
