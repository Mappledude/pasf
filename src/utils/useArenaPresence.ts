import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc, type FirestoreError, type Unsubscribe } from "firebase/firestore";
import { ensureAnonAuth, watchArenaPresence, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import type { ArenaPresenceEntry } from "../types/models";
import { isPresenceEntryActive } from "./presenceThresholds";

const presenceDisplayNameCache = new Map<string, string>();
const loggedPresenceDisplayNames = new Set<string>();

const logResolvedDisplayName = (playerId: string, normalized: string) => {
  if (loggedPresenceDisplayNames.has(playerId)) return;
  const escaped = normalized.replace(/"/g, '\\"');
  console.info(`[PRESENCE] join name="${escaped}" uid=${playerId}`);
  loggedPresenceDisplayNames.add(playerId);
};

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

const filterActiveEntries = (entries: ArenaPresenceEntry[]): ArenaPresenceEntry[] => {
  const now = Date.now();
  return entries.filter((entry) => isPresenceEntryActive(entry, now));
};

export const primePresenceDisplayNameCache = (
  playerId?: string | null,
  value?: string | null,
) => {
  if (!playerId) return;
  const normalized = normalizeDisplayName(value ?? undefined);
  if (!normalized) return;
  presenceDisplayNameCache.set(playerId, normalized);
  logResolvedDisplayName(playerId, normalized);
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
          logResolvedDisplayName(playerId, normalized);
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
          logResolvedDisplayName(playerId, normalized);
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
    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const flushEntries = () => {
      if (cancelled) return;
      setPlayers(applyCachedDisplayNames(latestEntries));
      setLoading(false);
    };

    const scheduleFlush = () => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
      debounceTimeout = setTimeout(() => {
        debounceTimeout = null;
        flushEntries();
      }, 2_000);
    };

    (async () => {
      try {
        setLoading(true);
        setError(null);
        await ensureAnonAuth();
        if (cancelled) return;
        unsub = watchArenaPresence(db, arenaId, (entries) => {
          if (cancelled) return;
          const currentGen = ++generation;
          latestEntries = filterActiveEntries(entries);
          scheduleFlush();
          const missingIds = collectMissingPlayerIds(latestEntries);
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
              scheduleFlush();
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
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
    };
  }, [arenaId, resolveDisplayName]);

  return { players, loading, error };
}

export const usePresenceRoster = (arenaId?: string) => {
  const { players } = useArenaPresence(arenaId);

  return useMemo(() => {
    const names: string[] = [];

    for (const entry of players) {
      const displayName =
        typeof entry.displayName === "string" ? entry.displayName.trim() : "";
      if (displayName.length > 0) {
        names.push(displayName);
      }
      if (names.length >= 3) {
        break;
      }
    }

    return { names, count: players.length };
  }, [players]);
};
