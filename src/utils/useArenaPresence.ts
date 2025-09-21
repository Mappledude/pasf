import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, type FirestoreError, type Unsubscribe } from "firebase/firestore";
import { ensureAnonAuth, watchArenaPresence, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import type { ArenaPresenceEntry } from "../types/models";

const presenceDisplayNameCache = new Map<string, string>();

const normalizeDisplayName = (value?: string | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const applyCachedDisplayNames = (entries: ArenaPresenceEntry[]): ArenaPresenceEntry[] =>
  entries.map((entry) => {
    const normalized = normalizeDisplayName(entry.displayName ?? null);
    const playerId = entry.playerId;
    if (playerId && normalized) {
      presenceDisplayNameCache.set(playerId, normalized);
      return { ...entry, displayName: normalized };
    }
    if (playerId) {
      const cached = presenceDisplayNameCache.get(playerId);
      if (cached) {
        return { ...entry, displayName: cached };
      }
    }
    return { ...entry, displayName: normalized };
  });

const collectMissingPlayerIds = (entries: ArenaPresenceEntry[]): string[] => {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const playerId = entry.playerId;
    if (!playerId || seen.has(playerId)) continue;
    if (presenceDisplayNameCache.has(playerId)) continue;
    if (normalizeDisplayName(entry.displayName ?? null)) continue;
    seen.add(playerId);
    missing.push(playerId);
  }
  return missing;
};

export const primePresenceDisplayNameCache = (
  playerId?: string | null,
  value?: string | null,
) => {
  if (!playerId) return;
  const normalized = normalizeDisplayName(value ?? undefined);
  if (!normalized) return;
  presenceDisplayNameCache.set(playerId, normalized);
};

export const usePresenceDisplayNameResolver = () => {
  const { player } = useAuth();

  useEffect(() => {
    if (player?.id) {
      primePresenceDisplayNameCache(player.id, player.displayName ?? null);
    }
  }, [player?.displayName, player?.id]);

  return useCallback(
    async (playerId?: string | null): Promise<string> => {
      if (!playerId) return "Player";
      const cached = presenceDisplayNameCache.get(playerId);
      if (cached) return cached;

      if (player?.id === playerId) {
        const normalized = normalizeDisplayName(player.displayName ?? null);
        if (normalized) {
          presenceDisplayNameCache.set(playerId, normalized);
          return normalized;
        }
      }

      try {
        const snap = await getDoc(doc(db, "players", playerId));
        const data = snap.data() as { name?: unknown; displayName?: unknown } | undefined;
        const raw =
          (typeof data?.displayName === "string" ? data.displayName : undefined) ??
          (typeof data?.name === "string" ? data.name : undefined);
        const normalized = normalizeDisplayName(raw ?? undefined);
        if (normalized) {
          presenceDisplayNameCache.set(playerId, normalized);
          return normalized;
        }
      } catch (err) {
        console.warn(`[PRESENCE] resolve displayName failed for ${playerId}`, err);
      }

      presenceDisplayNameCache.set(playerId, "Player");
      return "Player";
    },
    [player],
  );
};

interface UseArenaPresenceResult {
  players: ArenaPresenceEntry[];
  loading: boolean;
  error: FirestoreError | null;
}

export function useArenaPresence(arenaId?: string): UseArenaPresenceResult {
  const [players, setPlayers] = useState<ArenaPresenceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | null>(null);
  const resolveDisplayName = usePresenceDisplayNameResolver();

  useEffect(() => {
    if (!arenaId) {
      setPlayers([]);
      setLoading(false);
      setError(null);
      return;
    }

    let unsub: Unsubscribe | undefined;
    let cancelled = false;
    let generation = 0;
    let latestEntries: ArenaPresenceEntry[] = [];

    (async () => {
      try {
        setLoading(true);
        setError(null);
        await ensureAnonAuth();
        if (cancelled) return;
        unsub = watchArenaPresence(arenaId, (entries) => {
          if (cancelled) return;
          const currentGen = ++generation;
          latestEntries = entries;
          setPlayers(applyCachedDisplayNames(entries));
          setLoading(false);
          const missingIds = collectMissingPlayerIds(entries);
          if (!missingIds.length) {
            return;
          }
          const lookups = missingIds.map(async (playerId) => {
            try {
              await resolveDisplayName(playerId);
            } catch (err) {
              console.warn(`[PRESENCE] resolve displayName failed for ${playerId}`, err);
            }
          });
          Promise.all(lookups)
            .then(() => {
              if (cancelled) return;
              if (currentGen !== generation) return;
              setPlayers(applyCachedDisplayNames(latestEntries));
            })
            .catch((err) => {
              if (cancelled) return;
              console.warn("[PRESENCE] resolve display names failed", err);
            });
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
  }, [arenaId, resolveDisplayName]);

  return { players, loading, error };
}
