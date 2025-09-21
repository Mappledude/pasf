# Scoped Gap Analysis: From Lobby to Real 1v1 Multiplayer

This report enumerates the gaps between the current lobby scaffold and the "From Lobby to Real 1v1 Multiplayer" target experience. Sections A–J align with the brief and spell out (1) missing components or files and (2) the minimum implementation plan required so upcoming feature PRs (networking skeleton, combat core, seats/controls, leaderboard) can share a unified checklist.

## A. North Star, Constraints, and Success Criteria
- **Missing components / files**
  - No written owner for the multiplayer north star; `PRD.md` captures broad MVP goals but not the scoped 1v1 milestone.
  - No shared success-metric constants in code (e.g., target tick rate, acceptable latency budget).
- **Minimum implementation plan**
  1. Add a brief-specific overview (one pager or section in `PRD.md`) documenting the 1v1 milestone goals, risks, and non-goals.
  2. Introduce a `src/config/matchConstants.ts` module exporting tick rate, rollback window, target RTT, and round length so future systems reference a single source of truth.
  3. Update README to link the brief and constants to keep onboarding tight.

## B. Player Identity, Authentication, and Profiles
- **Missing components / files**
  - No explicit owner for ranked IDs vs. anonymous IDs; `src/context/AuthContext.tsx` and `src/firebase.ts` rely on anonymous auth without a bridge to persistent ranked identity.
  - No schema for storing per-match loadouts or elo information needed for matchmaking.
- **Minimum implementation plan**
  1. Extend `PlayerProfile` in `src/firebase.ts` (and Firestore rules) with ranked/MMR fields plus preferred loadout slots.
  2. Add a migration helper under `scripts/` (e.g., `scripts/backfillPlayerProfiles.ts`) to populate new fields for existing documents.
  3. Update `AuthContext` to emit both anonymous session IDs and long-lived profile IDs so the networking skeleton can stamp authoritative messages.

## C. Lobby, Matchmaking, and Session Ticketing
- **Missing components / files**
  - Lobby UI (`src/pages/HomePage.tsx`) lists arenas but lacks matchmaking state, seat reservations, or countdown flow.
  - No Firestore collections for match tickets (`/matchTickets`) or seat assignments.
  - Missing service functions to promote players from lobby to active match slots.
- **Minimum implementation plan**
  1. Define `MatchTicket`/`MatchSeat` types in `src/types/models.ts` and add Firestore helpers in `src/firebase.ts` for creating tickets, claiming seats, and expiring unused ones.
  2. Introduce a lobby controller (e.g., `src/pages/LobbyMatchmaker.tsx`) that drives ticket creation, polls seat status, and pushes the router to `/arena/:matchId` when ready.
  3. Update security rules to scope write access to a player's own ticket and seat documents.

## D. Arena Session Lifecycle and State Persistence
- **Missing components / files**
  - `src/pages/ArenaPage.tsx` still renders debug state instead of the Phaser scene; there is no match lifecycle (warmup, rounds, post-match) coordinator.
  - `src/lib/arenaState.ts` stores minimal HP/tick info and lacks structures for rounds, timers, or authoritative refs.
  - No server-side (Cloud Function or emulator) job to reset arenas between matches.
- **Minimum implementation plan**
  1. Create an arena session controller (e.g., `src/game/arena/MatchCoordinator.ts`) that mounts Phaser, listens to seat readiness, and transitions between warmup, fighting, and results.
  2. Replace the debug view in `ArenaPage.tsx` with the coordinator and embed the Phaser canvas.
  3. Expand Firestore schema (via helpers in `src/firebase.ts`) with `/matches/{matchId}/state` documents capturing phase, round timer, and authoritative tick to support rollback history.
  4. Add a Cloud Function (or local emulator script) that watches finished matches and cleans up `/arenas/*` subcollections.

## E. Networking Skeleton and Authoritative Transport
- **Updates**
  - Locked down Firestore arena input and seat documents so only authenticated owners can write, covering the brief's security gap for seat-bound input publishing.
- **Missing components / files**
  - `src/net/ActionBus.ts` exists but is not wired into the arena scene or battle reducer; there is no reconciliation layer between Firestore actions and the simulation history in `src/sim`.
  - No deterministic snapshot/rollback service; `src/sim/reducer.ts` runs locally only.
  - Firestore security rules do not yet gate action writes per seat or enforce sequence numbers.
- **Minimum implementation plan**
  1. Introduce a networking gateway (e.g., `src/game/net/MatchChannel.ts`) that wraps `ActionBus`, feeds inputs into the combat reducer, and mirrors authoritative snapshots to peers.
  2. Wire the arena scene to the gateway so local inputs publish through `ActionBus.publishInput` while remote actions hydrate via the reducer.
  3. Add sequence validation and seat ownership enforcement in `firestore.rules` to reject forged inputs.
  4. Extend `ActionBus` with heartbeat/ack support and move `THROTTLE_MS` constants to the new `matchConstants` module for reuse.

## F. Combat Core, Simulation, and Authoritative Rules
- **Missing components / files**
  - The deterministic reducer in `src/sim/reducer.ts` is isolated from Phaser entities and lacks authoritative hit detection integration.
  - No shared schema bridging reducer snapshots to `src/game/entities/Player`/`RemoteOpponent` or to Firestore snapshots.
  - Attack/hit rules inside Phaser are ad-hoc and bypass the reducer damage pipeline.
- **Minimum implementation plan**
  1. Define a serialization contract (`src/sim/codec.ts`) converting reducer snapshots into transportable JSON for both Firestore and Phaser clients.
  2. Refactor `ArenaScene` to derive entity positions/HP strictly from reducer snapshots instead of local physics, using a thin visual-only layer.
  3. Relocate damage calculation from Phaser overlap callbacks into reducer collision logic, emitting events that the networking skeleton can broadcast.
  4. Add unit tests in `src/sim/__tests__/` covering KO, respawn, and rollback recovery to guard deterministic behavior.

## G. Seats, Controls, and Input Abstraction
- **Missing components / files**
  - Input binding lives in `src/game/input/keys.ts` and is tailored for the training sandbox, not match seats.
  - No concept of seat slots (e.g., `seatA`, `seatB`) to map devices to players.
  - No UI for ready checks or for remapping controller vs. keyboard per seat.
- **Minimum implementation plan**
  1. Create a seat model (`src/types/seats.ts`) describing seat state, assigned playerId, device type, and readiness.
  2. Build a `SeatManager` in `src/game/input/SeatManager.ts` that claims seats, binds controls, and passes normalized inputs to the networking gateway.
  3. Extend the lobby/arena UI with a ready-up modal that surfaces seat assignment and exposes a minimal rebinding dialog (leveraging existing `KeyBinder`).
  4. Update presence documents to record seat occupancy so spectators remain read-only.

## H. User Interface, HUD, and Match Feedback
- **Missing components / files**
  - HUD in `src/game/arena/ArenaScene.ts` is placeholder text; no round timer, streak, or win indicators.
  - No results screen summarizing match outcome or offering rematch/exit actions.
  - Lack of damage/event messaging pipeline to feed UI components.
- **Minimum implementation plan**
  1. Implement a dedicated HUD module (`src/game/ui/MatchHud.tsx`) that consumes reducer state (HP, timer, round count) and renders within React overlay.
  2. Create a `MatchResultsModal` component under `src/components/` to display win/loss, leaderboard delta, and CTA buttons.
  3. Add an event bus (lightweight emitter in `src/game/core/Events.ts`) for KO, combo, and timer events so UI elements react without polling Firestore.

## I. Leaderboard, Progression, and Rewards
- **Missing components / files**
  - `src/firebase.ts` exposes `upsertLeaderboardEntry` but there is no match completion hook to call it.
  - No UI surface for the leaderboard within `src/pages/HomePage.tsx` or a dedicated `/leaderboard` route.
  - Security rules do not prevent clients from arbitrarily updating leaderboard stats.
- **Minimum implementation plan**
  1. Trigger leaderboard updates from the match coordinator when a round closes (server-authoritative, ideally via Cloud Function using match results doc).
  2. Build a leaderboard panel (`src/pages/LeaderboardPage.tsx`) and slot a summary widget into the lobby to reinforce stakes.
  3. Lock leaderboard mutations behind privileged backend role (Rules + Cloud Function) so clients can only read.
  4. Extend `LeaderboardEntry` with MMR deltas and history to support future seasons.

## J. Telemetry, QA Harnesses, and Operations
- **Missing components / files**
  - No structured logging or analytics events beyond ad-hoc `console.info` statements scattered through `src/pages` and `src/firebase.ts`.
  - Missing automated match replay export for regression debugging.
  - No deployment checklist mapping Firebase rules/functions to CI.
- **Minimum implementation plan**
  1. Introduce a lightweight telemetry layer (`src/lib/telemetry.ts`) that funnels events to Firebase Analytics or BigQuery exports, with typed event enums.
  2. Capture reducer history snapshots (already stored via `HISTORY_CAP`) and add a download/export button in debug builds to share replay JSON with QA.
  3. Add CI scripts (GitHub Actions) that run lint/test plus `firebase emulators:exec` smoke tests and verify rules deploy cleanly before merging.
  4. Document ops runbook in `REPORT.md` appendix once the above systems are in place.

## K. Fighter Art, Animation, and Asset Pipeline
- **Missing components / files**
  - Arena fighters still render as solid-color rectangles; there is no documented asset checklist covering the placeholder rig or incoming sprite sheets.
  - No manifest enumerating required sprite sets (idle/run/jump/punch/kick/hit/KO) for each fighter, so art handoff risks gaps.
- **Minimum implementation plan**
  1. Keep the existing stick-figure rig (rectangle body + hitbox) as the guaranteed fallback and document it in the asset checklist so designers know the baseline survives missing art.
  2. Create TODO slots for each fighter animation state (idle, run, jump, punch, kick, hit, KO) with expected resolution, pivot, and naming (e.g., `fighter-idle.png`) so sprite sheets can drop in without Phaser code churn.
  3. Ship an asset manifest (JSON or TS module) under `src/game/arena/` that declares the sprite keys required by the loader so QA can quickly confirm when all art milestones are met.

---

This gap analysis should be revisited after each milestone PR lands so the shared checklist stays accurate.
