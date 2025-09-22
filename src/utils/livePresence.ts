import type { LivePresence } from "../firebase";
import type { ArenaPresenceEntry } from "../types/models";

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readTimestamp = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (!value || typeof value !== "object") return undefined;
  const date = (value as { toDate?: () => Date }).toDate?.();
  return date?.toISOString();
};

export const livePresenceToArenaEntry = (live: LivePresence): ArenaPresenceEntry => {
  const raw = live as Record<string, unknown>;
  const presenceId = normalizeString((raw.presenceId as string) ?? undefined) ?? normalizeString(raw.playerId) ?? live.id;
  const playerId = normalizeString(raw.playerId) ?? presenceId;
  const codename = normalizeString(raw.codename) ?? "Agent";
  const displayName = normalizeString(live.displayName ?? raw.displayName);
  const authUid = normalizeString(live.authUid) ?? presenceId;
  const profileId = normalizeString(raw.profileId);
  const joinedAt = readTimestamp(raw.joinedAt);
  const lastSeen = typeof live.lastSeen === "number" ? new Date(live.lastSeen).toISOString() : readTimestamp(raw.lastSeen);
  const expireAt = readTimestamp(raw.expireAt);

  return {
    presenceId,
    playerId,
    codename,
    displayName,
    joinedAt,
    authUid,
    profileId,
    lastSeen,
    expireAt,
  };
};

export const mapLivePresenceToArenaEntries = (list: LivePresence[]): ArenaPresenceEntry[] =>
  list.map(livePresenceToArenaEntry);
