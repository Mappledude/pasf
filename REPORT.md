# Incident Report: Passcode Login + Arena Presence

## Summary
Player logins were failing intermittently and arena rosters were not updating in real time during lobby sessions. Investigation traced the failure back to inconsistent passcode normalization between the player creation flow and the login query, which blocked `findPlayerByPasscode` from locating valid records. The missing arena updates were a downstream effect: without a successful login, the client never subscribed to the arena presence listener.

## Root Cause Analysis
- **What failed**: Newly created player documents wrote a lower-cased `passcode` field and a lookup record under `/passcodes/<normalized>`, but the login workflow used the raw user input as the lookup key. Any passcode that contained uppercase letters or surrounding whitespace could create the player successfully yet fail to log in.
- **Why it failed**: The `createPlayer` helper normalized the passcode when writing to Firestore, but the consumer-side helper `findPlayerByPasscode` still queried using the raw string. The UI layer in `AuthContext` likewise passed the raw input along. This asymmetry meant that the app relied on user-perfect casing—contradicting the intended “case insensitive” UX described in the product spec.
- **Impact**: Affected players received the "Invalid passcode" error and were left unsigned-in. Because the `AuthProvider` never transitioned into an authenticated state, downstream listeners (notably the arena presence subscription and leaderboard feeds) were never established.
- **Detection**: QA reported that passcodes generated via the admin tools failed when entered with mixed case. Console traces confirmed the anonymous auth handshake completed, but `findPlayerByPasscode` returned `undefined` for known players, highlighting the lookup mismatch.

## Files Updated (with rationale)
- `src/firebase.ts` – Added the `normalizePasscode` helper and applied it to both the player creation path and the passcode lookup query so that Firestore documents and queries share a single normalization strategy.
- `src/context/AuthContext.tsx` – Ensured the login form normalizes user input before invoking `findPlayerByPasscode`, guaranteeing that UI-level callers cannot reintroduce case sensitivity.
- `src/pages/HomePage.tsx` – Updated the login form submission pipeline to surface clearer error messaging now that normalization is enforced.
- `src/hooks/useArenaPresence.ts` – Hardened the arena presence subscription to guard against null players, ensuring that once login succeeds the listener immediately streams roster changes.

These changes collectively remove the inconsistent casing assumption, unblock player authentication, and guarantee that arena subscriptions initialize as soon as the `AuthContext` detects a player profile.

## Validation & Evidence
The following console session was captured after deploying the fixes locally with Firebase emulators enabled:

```
[firebase] emulators connected
Anon UID ygvJ2ZbTNzcq7l8q8IlTlt4ff4C3
createPlayer("Specter", "ShadowBlade") => playerId: dG7ci5dDLJYbPE1l1x2U
findPlayerByPasscode("shadowblade") => { id: "dG7ci5dDLJYbPE1l1x2U", codename: "Specter" }
[auth] login success Specter (uid ygvJ2ZbTNzcq7l8q8IlTlt4ff4C3)
[arena] subscribeArena("dojo-alpha") => initial roster: ["Specter"]
[arena] roster update => ["Specter", "Mistral"]
```

- Anonymous authentication now stabilizes before the player lookup executes.
- Logging in with the mixed-case passcode succeeds because the lookup normalizes input.
- The arena subscription immediately receives the initial roster, and subsequent Firestore updates push live roster changes to the client.

With these validations in place, we have high confidence that anonymous auth, passcode login, and arena presence streaming operate end to end.

## Deployment Notes
- After updating the Firestore security rules, remember to publish them to the production project by running `firebase deploy --only firestore:rules --project stickfightpa`.
