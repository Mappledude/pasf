import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, type FirestoreError } from "firebase/firestore";

import { db } from "../firebase";
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
    const arenasQuery = query(collection(db, "arenas"), orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
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

    return () => {
      unsubscribe();
    };
  }, []);

  return { arenas, loading, error };
}
