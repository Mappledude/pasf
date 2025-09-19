export interface CachedPlayer {
  playerId: string;
  name: string;
}

const STORAGE_KEY = "stickfight:player";

export function getCachedPlayer(): CachedPlayer | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedPlayer;
    if (parsed && parsed.playerId && parsed.name) {
      return parsed;
    }
  } catch (err) {
    console.warn("Failed to parse cached player", err);
  }
  return null;
}

export function cachePlayer(player: CachedPlayer): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
}

export function clearCachedPlayer(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
