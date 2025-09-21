import { useEffect, useState } from "react";
import type { FirestoreError, Unsubscribe } from "firebase/firestore";
import { ensureAnonAuth, watchArenaSeats } from "../firebase";
import type { ArenaSeatAssignment } from "../types/models";

interface UseArenaSeatsResult {
  seats: ArenaSeatAssignment[];
  loading: boolean;
  error: FirestoreError | null;
}

export function useArenaSeats(arenaId?: string): UseArenaSeatsResult {
  const [seats, setSeats] = useState<ArenaSeatAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | null>(null);

  useEffect(() => {
    if (!arenaId) {
      setSeats([]);
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
        unsub = watchArenaSeats(arenaId, (entries) => {
          if (cancelled) return;
          setSeats(entries);
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

  return { seats, loading, error };
}
