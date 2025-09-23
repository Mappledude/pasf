# StickFight (Lobby Scaffold)

Minimal Firebase + Vite TypeScript scaffold with:
- Anonymous Auth
- Firestore data model (players, passcodes, arenas, presence)
- Basic pages: `/` (lobby), `/admin` (boss tools), `/arena/:id` (presence + exit), `/training` (Phaser test scene)

## Prereqs
- Firebase project: **stickfightpa**
- Enable: Firestore, Authentication (Anonymous), Hosting
- Add your domain under Auth → Settings → Authorized domains (Hosting auto-adds on deploy)

## Local Dev
```bash
npm install
npm run dev
```

The dev server binds to `0.0.0.0` so it works in Codespaces and remote containers. Visit `http://localhost:5173/` (or the forwarded port) and navigate to `/training` for the Phaser training route. Legacy links to `/training.html` will redirect automatically.

To clean Vite's cache, run `npm run clean:vite`.

## Quick sanity check (in browser console)

After loading the app locally, you can confirm Firebase connectivity by pasting this snippet into the browser console:

```js
(async () => {
  const { ensureAnonAuth, listArenas } = await import("/src/firebase.ts");
  const user = await ensureAnonAuth();
  console.log("Anon UID", user.uid);
  console.log("Arenas", await listArenas());
})();
```

It signs in anonymously (if needed) and fetches the arenas collection, logging the results.

## Firestore Rules Playground

The repository includes a ready-to-run Rules Playground request at `docs/rules-playground.json`. To validate the presence rules:

1. Open the Firebase Console → Firestore → Rules.
2. Click **Rules Playground**.
3. Paste the contents of `docs/rules-playground.json` into the request editor.
4. Run the simulation and confirm it returns **ALLOW**.

This payload exercises the `/arenas/CLIFF/presence/testPresence` create path with the expected `authUid`, timestamps, and heartbeat fields.
