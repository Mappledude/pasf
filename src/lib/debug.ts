declare global {
  interface Window {
    __PASf_DEBUG?: boolean;
  }
}

function computeDebugEnabled(): boolean {
  // Enable via query string ?debug=1 or localStorage.PASf_DEBUG="1"
  try {
    if (typeof window !== "undefined") {
      if (/[?&]debug=1\b/.test(window.location.search)) return true;
      if (window.localStorage?.getItem("PASf_DEBUG") === "1") return true;
    }
  } catch {}
  // Fallback: allow Vite flag, default off in prod
  try {
    // @ts-ignore
    if (import.meta.env?.VITE_DEBUG_LOGS === "true") return true;
    // @ts-ignore
    if (import.meta.env?.DEV) return true;
  } catch {}
  return false;
}

export function enableDebug(on = true) {
  if (typeof window === "undefined") return;
  window.__PASf_DEBUG = !!on;
}

export function dbg(tag: string, payload?: unknown) {
  if (typeof window === "undefined") return;
  if (window.__PASf_DEBUG) {
    // Use info (visible by default even with default console settings)
    // Avoid JSON stringify to preserve objects live in console
    // eslint-disable-next-line no-console
    console.info(`[DEBUG] ${tag}`, payload ?? "");
  }
}

// One-time setup: global traps
export function setupGlobalDebug() {
  if (typeof window === "undefined") return;
  if (window.__PASf_DEBUG === undefined) window.__PASf_DEBUG = computeDebugEnabled();

  // Trap uncaught errors
  window.addEventListener("error", (e) => {
    // eslint-disable-next-line no-console
    console.error("[ERR] window.error", {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      error: e.error,
    });
  });

  // Trap unhandled promise rejections
  window.addEventListener("unhandledrejection", (e) => {
    // eslint-disable-next-line no-console
    console.error("[ERR] unhandledrejection", { reason: e.reason });
  });
}
