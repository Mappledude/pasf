import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { Arena } from "../types/models";

export const ArenaPage = () => {
  const { arenaId } = useParams<{ arenaId: string }>();
  const [arena, setArena] = useState<Arena | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadArena = async () => {
      if (!arenaId) {
        setError("Arena not found");
        return;
      }
      try {
        const arenaDoc = await getDoc(doc(db, "arenas", arenaId));
        if (!arenaDoc.exists()) {
          setError("Arena not found");
          return;
        }
        const data = arenaDoc.data();
        setArena({
          id: arenaDoc.id,
          name: data.name,
          description: data.description ?? "",
          capacity: data.capacity ?? undefined,
          isActive: Boolean(data.isActive),
          createdAt: data.createdAt?.toDate?.().toISOString?.() ?? new Date().toISOString(),
        });
      } catch (err) {
        console.error(err);
        setError("Failed to load arena");
      }
    };

    loadArena().catch((err) => console.error(err));
  }, [arenaId]);

  return (
    <main>
      <section className="card">
        {error ? (
          <>
            <h1>Arena Error</h1>
            <p>{error}</p>
          </>
        ) : arena ? (
          <>
            <h1>{arena.name}</h1>
            <p>{arena.description || "No description yet."}</p>
            <p>Status: {arena.isActive ? "Active" : "Inactive"}</p>
            {arena.capacity ? <p>Capacity: {arena.capacity}</p> : null}
            <p className="muted">
              Gameplay coming soon. Hang tight while we wire up the battles!
            </p>
          </>
        ) : (
          <>
            <h1>Loading arena…</h1>
            <p>Please wait while we fetch arena details.</p>
          </>
        )}
      </section>
    </main>
  );
};
