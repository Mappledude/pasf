# Reproduction Checklist

- [ ] **Prep Firebase**
  - Launch the local emulators (`npm run emulators`) or ensure the staging project credentials are configured.
  - Open the app at `http://localhost:5173/`.
- [ ] **Create a player**
  - Navigate to `/admin`.
  - Enter a codename and mixed-case passcode (e.g., `ShadowBlade`).
  - Submit to create the player and note the generated player ID in the admin console.
  - Verify Firestore now contains:
    - `/players/<playerId>` with the codename and a lower-cased `passcode`.
    - `/passcodes/shadowblade` pointing to the same `playerId`.
- [ ] **Log in with passcode**
  - Return to `/` and enter the same passcode with any casing or whitespace.
  - Confirm the lobby loads, your codename appears in the header, and the console logs the `[auth] login success` message.
- [ ] **Observe arena presence**
  - Visit `/arena/dojo-alpha`.
  - Observe the console logs for `[arena] subscribeArena` and roster updates.
  - In a separate browser tab (or emulator session), join the same arena with another account to see live updates stream in.
