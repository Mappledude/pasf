import { useMemo } from "react";

import type { ArenaPresenceEntry } from "../types/models";

export interface PresenceRosterEntry {
  key: string;
  name: string;
  entry: ArenaPresenceEntry;
}

const normalizeName = (value?: string | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const deriveRosterName = (entry: ArenaPresenceEntry): string => {
  const displayName = normalizeName(entry.displayName ?? null);
  if (displayName) return displayName;
  const codename = normalizeName(entry.codename ?? null);
  if (codename) return codename;
  return "Player";
};

export const usePresenceRoster = (
  entries: ArenaPresenceEntry[],
): PresenceRosterEntry[] =>
  useMemo(() => {
    const deduped = new Map<string, PresenceRosterEntry>();
    entries.forEach((entry, index) => {
      const key =
        entry.playerId ??
        entry.authUid ??
        entry.profileId ??
        (entry.codename ? `codename:${entry.codename}` : `idx:${index}`);
      deduped.set(key, {
        key,
        name: deriveRosterName(entry),
        entry,
      });
    });
    return Array.from(deduped.values());
  }, [entries]);

export const formatRosterNames = (names: string[], limit = 3): string => {
  if (names.length === 0) return "";
  const trimmed = names.map((name) => name.trim()).filter((name) => name.length > 0);
  if (trimmed.length === 0) return "";
  if (trimmed.length <= limit) {
    return trimmed.join(", ");
  }
  const visible = trimmed.slice(0, limit).join(", ");
  const remaining = trimmed.length - limit;
  return `${visible} (+${remaining})`;
};

