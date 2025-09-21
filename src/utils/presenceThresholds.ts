import type { ArenaPresenceEntry } from "../types/models";

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_ACTIVE_WINDOW_MS = 20_000;
export const PRESENCE_GRACE_BUFFER_MS = 60_000;

const parseIsoDate = (value?: string | null): number => {
  if (typeof value !== "string" || value.length === 0) {
    return Number.NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const isPresenceEntryActive = (
  entry: ArenaPresenceEntry,
  now: number = Date.now(),
): boolean => {
  const lastSeenMs = parseIsoDate(entry.lastSeen ?? null);
  if (Number.isFinite(lastSeenMs)) {
    return now - lastSeenMs <= HEARTBEAT_ACTIVE_WINDOW_MS;
  }

  const expireAtMs = parseIsoDate(entry.expireAt ?? null);
  if (Number.isFinite(expireAtMs)) {
    return now <= expireAtMs;
  }

  return false;
};
