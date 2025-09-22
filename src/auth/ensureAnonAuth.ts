import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "../firebase";

let ready: Promise<string> | null = null;

export const ensureAnonAuth = (): Promise<string> => {
  if (ready) return ready;
  ready = new Promise<string>((resolve, reject) => {
    const off = onAuthStateChanged(auth, async (u) => {
      if (u) { off(); resolve(u.uid); return; }
      try {
        const cred = await signInAnonymously(auth);
        off();
        resolve(cred.user.uid);
      } catch (e) {
        reject(e);
      }
    });
  });
  return ready;
};
