import { useEffect, useState } from "react";
import type { FirestoreError, Unsubscribe } from "firebase/firestore";
import { ensureAnonAuth, watchArenaPresence } from "../firebase";
import type { ArenaPresenceEntry } from "../types/models";

interface UseArenaPresenceResult {
  players: ArenaPresenceEntry[];
  loading: boolean;
  error: FirestoreError | null;
}

export function useArenaPresence(arenaId?: string): UseArenaPresenceResult {
  const [players, setPlayers] = useState<ArenaPresenceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | null>(null);

  useEffect(() => {
    if (!arenaId) {
      setPlayers([]);
      setLoading(false);
      setError(null);
      return;
    }

    let unsub: Unsubscribe | undefined;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        await ensureAnonAuth();
        if (cancelled) return;
        unsub = watchArenaPresence(arenaId, (entries) => {
          if (cancelled) return;
          setPlayers(entries);
          setLoading(false);
        });
      } catch (err) {
        if (cancelled) return;
        setError(err as FirestoreError);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [arenaId]);

  return { players, loading, error };
}
