const randomSuffix = (): string => Math.random().toString(16).slice(2, 10);

const buildPresenceId = (authUid: string): string => {
  const globalCrypto = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  const base = typeof globalCrypto?.randomUUID === "function" ? globalCrypto.randomUUID() : randomSuffix();
  const suffix = base.replace(/-/g, "").slice(0, 8) || randomSuffix();
  return `${authUid}-${suffix}`;
};

export const loadTabPresenceId = (authUid: string): string => {
  if (!authUid) {
    throw new Error("authUid is required to compute presenceId");
  }

  if (typeof window === "undefined") {
    return buildPresenceId(authUid);
  }

  const storage = window.sessionStorage;
  const key = `presenceId:${authUid}`;

  try {
    const cached = storage.getItem(key);
    if (cached && cached.startsWith(`${authUid}-`)) {
      return cached;
    }
  } catch (error) {
    console.warn("[PRESENCE] sessionStorage get failed", error);
  }

  const next = buildPresenceId(authUid);

  try {
    storage.setItem(key, next);
  } catch (error) {
    console.warn("[PRESENCE] sessionStorage set failed", error);
  }

  return next;
};
