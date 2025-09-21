import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, type FirestoreError } from "firebase/firestore";

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
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const setupListener = async () => {
      try {
        await ensureAnonAuth();
        if (cancelled) {
          return;
        }

        const arenasQuery = query(collection(db, "arenas"), orderBy("createdAt", "desc"));

        unsubscribe = onSnapshot(
          arenasQuery,
          (snapshot) => {
            const data = snapshot.docs.map((docSnap) => {
              const docData = docSnap.data() as any;
              return {
                id: docSnap.id,
                name: docData.name,
                description: docData.description ?? undefined,
                capacity: docData.capacity ?? undefined,
                isActive: !!docData.isActive,
                createdAt: docData.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
              } as Arena;
            });
            setArenas(data);
            setLoading(false);
            setError(null);
          },
          (err) => {
            setError(err);
            setLoading(false);
          },
        );
      } catch (err) {
        if (!cancelled) {
          setError(err as FirestoreError);
          setLoading(false);
        }
      }
    };

    void setupListener();

    return () => {
      cancelled = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  return { arenas, loading, error };
}
