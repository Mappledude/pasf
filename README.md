# StickFight Firebase MVP

Prototype lobby and admin tools for the StickFight brief. This repo provides a Vite + TypeScript scaffold with Firebase Authentication and Firestore helpers for player passcodes, arenas, and presence tracking.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `firestore.rules` into your Firebase project or emulator.
3. Start the Vite dev server:
   ```bash
   npm run dev
   ```
4. Open the pages directly:
   - `/index.html` – player login and arena list
   - `/arena.html?arena=<arenaId>` – placeholder arena view
   - `/admin.html` – temporary boss tools (development only)

> **Note:** Anonymous auth is used for all sessions. Passcodes map to player documents through `passcodes/{passcode}`. Security rules are intentionally permissive for development and must be hardened before launch.

## Firestore data model

- `meta/config`
  - `bossNote`: informational text for the boss dashboard
- `players/{playerId}`
  - `name`, `passcodeId`, `stats`, optional `settings`
- `passcodes/{passcode}`
  - Stores `playerId`
- `arenas/{arenaId}`
  - `name`, `active`
  - `presence/{playerId}` subcollection for occupants

## Development notes

- `src/firebase.ts` bootstraps Firebase and anonymous auth helpers.
- `src/db.ts` centralizes reads/writes for Firestore collections.
- `src/auth.ts` keeps the cached player identity in local storage.
- Front-end scripts under `public/` use lightweight DOM scaffolds so gameplay wiring can be added later.
- `firestore.rules` exposes permissive read/write access for authenticated clients (anonymous included). Harden in a later brief.

Run formatting and linting through your preferred tools. No automated checks are configured yet.
