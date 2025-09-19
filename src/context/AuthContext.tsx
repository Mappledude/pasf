import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth, findPlayerByPasscode, maybeConnectEmulators, signInAnonymouslyWithTracking, updatePlayerActivity } from "../firebase";
import type { PlayerProfile } from "../types/models";

interface AuthContextValue {
  user: User | null;
  player: PlayerProfile | null;
  loading: boolean;
  login: (passcode: string) => Promise<PlayerProfile>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    maybeConnectEmulators();
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setPlayer(null);
        setLoading(false);
        return;
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = useCallback(async (passcode: string) => {
    setLoading(true);
    const userCredential = user ?? (await signInAnonymouslyWithTracking());
    setUser(userCredential);
    const playerProfile = await findPlayerByPasscode(passcode.trim());
    if (!playerProfile) {
      setLoading(false);
      throw new Error("Invalid passcode. Ask the Boss for access.");
    }
    await updatePlayerActivity(playerProfile.id);
    setPlayer(playerProfile);
    setLoading(false);
    return playerProfile;
  }, [user]);

  const logout = useCallback(async () => {
    await signOut(auth);
    setPlayer(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      player,
      loading,
      login,
      logout,
    }),
    [user, player, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return ctx;
};
