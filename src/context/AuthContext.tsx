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
  updatePlayerActivity,
  maybeConnectEmulators,
  loginWithPasscode,
} from "../firebase";
import type { PlayerProfile } from "../types/models";

type AnyUser = { uid: string } | null;

interface AuthContextValue {
  user: AnyUser;
  player: PlayerProfile | null;
  loading: boolean;
  authReady: boolean;
  login: (passcode: string) => Promise<PlayerProfile>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const [user, setUser] = useState<AnyUser>(null);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    maybeConnectEmulators();

    ensureAnonAuth()
      .catch((e) => {
        console.warn("ensureAnonAuth failed (dev ok):", e);
      })
      .finally(() => {
        setAuthReady(true);
      });

    const unsubscribe = onAuth((uid) => {
      setUser(uid ? { uid } : null);
      if (!uid) setPlayer(null);
    });

    return unsubscribe;
  }, []);

  const login = useCallback(
    async (passcode: string) => {
      setBusy(true);
      try {
        const playerProfile = await loginWithPasscode(passcode);
        await updatePlayerActivity(playerProfile.id).catch(() => {});
        setPlayer(playerProfile);
        navigate("/");
        return playerProfile;
      } finally {
        setBusy(false);
      }
    },
    [navigate],
  );

  const logout = useCallback(async () => {
    setPlayer(null);
    setUser(null);
  }, []);

  const value = useMemo(() => {
    const loading = !authReady || busy;
    return { user, player, loading, authReady, login, logout };
  }, [user, player, authReady, busy, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
};
