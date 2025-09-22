import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { app } from "./firebase";

export function ensureAuth() {
  const auth = getAuth(app);
  onAuthStateChanged(auth, (u) => {
    if (u) {
      console.info("[AUTH] ready", { uid: u.uid });
    } else {
      signInAnonymously(auth)
        .then(() => console.info("[AUTH] anon sign-in started"))
        .catch((e) => console.info("[AUTH] anon error", e));
    }
  });
}
