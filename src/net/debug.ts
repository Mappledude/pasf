export const ARENA_NET_DEBUG = import.meta.env?.VITE_DEBUG_ARENA_NET === "true";

export function debugLog(message: string, ...args: unknown[]): void {
  if (!ARENA_NET_DEBUG) {
    return;
  }
  // eslint-disable-next-line no-console
  console.debug(message, ...args);
}
