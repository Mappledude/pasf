import { useEffect, useState } from "react";
import { doc, onSnapshot, type FirestoreError, type Unsubscribe } from "firebase/firestore";

import { db } from "../firebase";

interface UseArenaMetaResult {
  arenaName: string | null;
  loading: boolean;
  error: FirestoreError | null;
}

export function useArenaMeta(arenaId?: string): UseArenaMetaResult {
  const [arenaName, setArenaName] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(() => Boolean(arenaId));
  const [error, setError] = useState<FirestoreError | null>(null);

  useEffect(() => {
    if (!arenaId) {
      setArenaName(null);
      setLoading(false);
      setError(null);
      return;
    }

    let unsub: Unsubscribe | undefined;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setArenaName(null);

    const arenaRef = doc(db, "arenas", arenaId);

    unsub = onSnapshot(
      arenaRef,
      (snapshot) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        if (!snapshot.exists()) {
          console.warn(`[ARENA] metadata missing id=${arenaId}`);
          setArenaName(null);
          return;
        }
        const data = snapshot.data() as { name?: unknown } | undefined;
        const name = typeof data?.name === "string" && data.name.trim().length > 0 ? data.name : null;
        setArenaName(name);
      },
      (err) => {
        if (cancelled) {
          return;
        }
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [arenaId]);

  return { arenaName, loading, error };
}
