import { getApp } from "firebase/app";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "../firebase";

let inflight: Promise<string> | null = null;

const RETRYABLE_AUTH_ERRORS = new Set([
  "auth/internal-error",
  "auth/network-request-failed",
  "auth/too-many-requests",
]);

export async function ensureAnonAuth(retryMs = 0): Promise<string> {
  if (inflight) return inflight;
  console.info("[ARENA] firebase-project", { projectId: getApp().options.projectId });

  inflight = (async () => {
    if (auth.currentUser) {
      const uid = auth.currentUser.uid;
      console.info("[ARENA] auth", { uid });
      return uid;
    }

    try {
      await signInAnonymously(auth);
      const uid = await new Promise<string>((resolve, reject) => {
        const off = onAuthStateChanged(
          auth,
          (u) => {
            off();
            if (u) {
              resolve(u.uid);
            } else {
              reject(new Error("anon-auth-missing-user"));
            }
          },
          (err) => {
            off();
            reject(err);
          },
        );
      });
      console.info("[ARENA] auth", { uid });
      return uid;
    } catch (e: any) {
      inflight = null;
      const code = e?.code ?? e?.name;
      const message = String(e?.message ?? e);
      if (RETRYABLE_AUTH_ERRORS.has(code)) {
        const delay = Math.floor(250 + Math.random() * 750);
        console.warn("[AUTH] ensureAnonAuth retry", { code, delay, message });
        await new Promise((r) => setTimeout(r, delay));
        return ensureAnonAuth(0);
      }
      if (retryMs > 0) {
        await new Promise((r) => setTimeout(r, retryMs));
        return ensureAnonAuth(0);
      }
      throw e;
    }
  })();

  try {
    return await inflight;
  } finally {
    if (!auth.currentUser) inflight = null;
  }
}
