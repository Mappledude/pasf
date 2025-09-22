import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "../firebase";

let ready: Promise<string> | null = null;
export const ensureAnonAuth = (): Promise<string> => {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, async (u) => {
      if (u) { off(); console.info("[ARENA] auth", { uid: u.uid }); resolve(u.uid); return; }
      try { const cred = await signInAnonymously(auth); off(); console.info("[ARENA] auth", { uid: cred.user.uid }); resolve(cred.user.uid); }
      catch (e) { console.error("[ARENA] auth-failed", e); reject(e); }
    });
  });
  return ready;
};
