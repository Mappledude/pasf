import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type FirestoreError,
  type Unsubscribe,
} from "firebase/firestore";
import { db, ensureAnonAuth } from "../firebase";
import type { Arena } from "../types/models";

interface UseArenasResult {
  arenas: Arena[];
  loading: boolean;
  error: FirestoreError | null;
}

export function useArenas(): UseArenasResult {
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | null>(null);

  useEffect(() => {
    let unsub: Unsubscribe | null = null;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Ensure rules pass before any reads
        await ensureAnonAuth();
        if (cancelled) return;

        const arenasQuery = query(
          collection(db, "arenas"),
          orderBy("createdAt", "desc")
        );

        unsub = onSnapshot(
          arenasQuery,
          (snap) => {
            if (cancelled) return;
            const data: Arena[] = snap.docs.map((docSnap) => {
              const d = docSnap.data() as any;
              return {
                id: docSnap.id,
                name: d.name,
                description: d.description ?? undefined,
                capacity: d.capacity ?? undefined,
                isActive: !!d.isActive,
                createdAt:
                  d.createdAt?.toDate?.()?.toISOString?.() ??
                  new Date().toISOString(),
              };
            });
            setArenas(data);
            setLoading(false);
            setError(null);
          },
          (err) => {
            if (cancelled) return;
            setError(err);
            setLoading(false);
          }
        );
      } catch (e) {
        if (!cancelled) {
          setError(e as FirestoreError);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  return { arenas, loading, error };
}
