# Multiplayer Verification Guide

This playbook walks through automated and manual checks for the Firestore-backed multiplayer flow. Use it when validating a fresh clone, new rule set, or large gameplay change.

## 1. Run the Firestore emulator tests

1. Install dependencies and build the Vitest suite once:
   ```bash
   npm install
   npm run test:build
   ```
2. Execute the multiplayer integration tests against the local Firestore emulator. The command below boots an ephemeral emulator, runs the Vitest suite, and then tears the emulator down:
   ```bash
   npx firebase emulators:exec --only firestore "npm run test:run"
   ```
   The emulator binds to `localhost:8080` by default. If you already have an emulator running, replace the command above with:
   ```bash
   export FIRESTORE_EMULATOR_HOST=localhost:8080
   npm run test:run
   ```
   Either path exercises the arena presence code against the rules bundle compiled at `firestore.rules`.

## 2. Deploy the rules bundle

After the automated tests pass, push the latest security rules to the project:

```bash
npx firebase deploy --only firestore:rules
```

The command uses `firebase.json` to locate `firestore.rules` and uploads it to the default project (set via `firebase use`). Double-check that you are targeting `stickfightpa` or an appropriate staging project before deploying.

## 3. Manual two-tab verification

1. Start the Vite dev server so both tabs point at the same emulator-backed build:
   ```bash
   npm run dev
   ```
2. Open two browser tabs (or windows) to `http://localhost:5173/arena/dojo-alpha`.
3. In each tab, sign in with a different passcode so the roster contains two live presences.
4. Open the browser console in both tabs and confirm the following logs appear once both sessions are seated:

   ```text
   [PRESENCE] started { "arenaId": "dojo-alpha", "presenceId": "presence_<TAB_1>" }
   [PRESENCE] roster stable { "count": 2, "ids": ["presence_<TAB_1>", "presence_<TAB_2>"] }
   [WRITER] elected { "presenceId": "presence_<TAB_1>", "arenaId": "dojo-alpha" }
   ```

   * `[PRESENCE] started` fires when the hook successfully registers the local tab's heartbeat with Firestore.【F:src/utils/useArenaRuntime.tsx†L73-L98】
   * `[PRESENCE] roster stable` indicates that at least two presences are visible and the debounced roster watcher has settled.【F:src/utils/useArenaRuntime.tsx†L155-L163】
   * `[WRITER] elected` confirms that the deterministic election loop selected one presence to author arena state snapshots.【F:src/utils/useArenaRuntime.tsx†L165-L195】

5. Trigger movement or attacks in one tab and confirm the other receives updates without log errors.
6. Close one tab and verify the remaining tab logs a new `[WRITER] elected` line after the debounce window, proving leadership failover.

Document any anomalies (missing logs, repeated writer elections, or presence churn) along with the timestamps so the next investigation can start quickly.
