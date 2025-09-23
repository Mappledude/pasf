# Firestore Data Inventory

## arenas/{arenaId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `id` | string | Optional; defaults to document id | `ensureArenaFixed` | Stored redundantly for convenience when seeding from the client. |
| `title` | string | Optional; default `arenaId` | `ensureArenaFixed` | Historical field kept when creating arenas on first launch. |
| `name` | string | Required via admin UI | `createArena` | Display name in UI. |
| `description` | string | Optional; defaults to empty string | `createArena` | User-facing description. |
| `capacity` | number \| null | Optional; defaults to null | `createArena` | Lobby capacity hint. |
| `isActive` | boolean | Defaults to `true` | `createArena` | Marks arenas available to players. |
| `mode` | string | Optional; defaults to `"CLIFF"` | `ensureArenaDocument` | Used by experimental map selector. |
| `createdAt` | server timestamp | Auto-set on first creation | `ensureArenaFixed`, `createArena` | Immutable creation audit. |
| `rulesProbeAt` | server timestamp | Added on presence start | `startPresence` | Used to confirm write access when clients join. |
| `rulesProbeBy` | string (uid) | Required with `rulesProbeAt` | `startPresence` | Auth UID that last probed write rules. |

### Subcollections

#### arenas/{arenaId}/debug/{docId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `at` | server timestamp | Required | `ensureArenaFixed` | Heartbeat used to verify write permissions. |
| `who` | string (uid) | Optional | `ensureArenaFixed` | UID that attempted the probe. |

#### arenas/{arenaId}/presence/{presenceId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `authUid` | string | Required | `startPresence` | Must match `request.auth.uid` per security rules. |
| `playerId` | string \| null | Optional; defaults to null | `startPresence` | Linked lobby profile; null when anonymous. |
| `profile` | object \| null | Optional | `startPresence` | Cached profile snapshot (currently `{ displayName?: string }`). |
| `arenaId` | string | Optional | `startPresence` bootstrap | Present on legacy join flow; ignored by roster. |
| `codename` | string | Optional | `watchArenaPresence` derived | Legacy lobby alias when available. |
| `displayName` | string | Optional | `watchArenaPresence` resolver | Preferred roster label resolved from `profile` or `players` cache. |
| `lastSeen` | number (ms since epoch) | Required | `startPresence` heartbeats | Updated every heartbeat to filter stale presences. |
| `lastSeenSrv` | server timestamp | Optional | `startPresence` | Server authoritative heartbeat timestamp. |
| `expireAt` | server timestamp | Optional | Presence TTL roadmap | Used by roster to precompute expiry when populated. |
| `joinedAt` | server timestamp | Optional | Legacy join flow | Preserved across reconnects when available. |
| `stage` | string (`"start"`, `"beat"`, `"stop"`) | Required | `startPresence` | Indicates lifecycle event for diagnostics. |

##### Example payloads

Presence start:
```json
{
  "authUid": "u123",
  "playerId": "playerA",
  "profile": { "displayName": "FighterOne" },
  "lastSeen": 1713400000000,
  "lastSeenSrv": { "__datatype__": "serverTimestamp" },
  "stage": "start"
}
```

Presence heartbeat:
```json
{
  "authUid": "u123",
  "playerId": "playerA",
  "lastSeen": 1713400010000,
  "stage": "beat"
}
```

Presence stop (merge-write on unload):
```json
{
  "lastSeen": 1713400020000,
  "lastSeenSrv": { "__datatype__": "serverTimestamp" },
  "stage": "stop"
}
```

#### arenas/{arenaId}/inputs/{presenceId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `playerId` | string | Defaults to `presenceId` | `writeArenaInput` | Mirrors presence id to keep per-player aggregates. |
| `presenceId` | string | Required | `writeArenaInput` | Document id; duplicated for security assertions. |
| `authUid` | string | Required | `writeArenaInput` | Must equal authenticated UID. |
| `codename` | string | Optional | `writeArenaInput` | Lobby codename for debugging. |
| `left` / `right` / `jump` / `attack` | boolean | Optional | `writeArenaInput` | Latest digital inputs for each control. |
| `attackSeq` | number | Optional | `writeArenaInput` | Monotonic counter for combo detection. |
| `updatedAt` | server timestamp | Required | `writeArenaInput` | Updated on every enqueue to throttle stale docs. |

#### arenas/{arenaId}/inputs/{presenceId}/events/{eventId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `type` | string | Required | `writeArenaInput` (ActionBus) | Indicates control event such as `"jump"` or `"attack"`. |
| `authUid` | string | Required | `writeArenaInput` (ActionBus) | Must match authenticated user. |
| `presenceId` | string | Required | `writeArenaInput` (ActionBus) | Fan-out key for downstream processing. |
| `createdAt` | number (ms since epoch) | Required | `writeArenaInput` (ActionBus) | Client timestamp for ordering within a presence stream. |
| `…payload` | any | Optional | `writeArenaInput` (ActionBus) | Additional event-specific keys mirrored from input payload. |

##### Example input event
```json
{
  "type": "attack",
  "authUid": "u123",
  "presenceId": "pres-abc",
  "createdAt": 1713400005000,
  "attackSeq": 7
}
```

#### arenas/{arenaId}/state/current

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `tick` | number | Required; defaults to `0` | `ensureArenaFixed`, `writeStateSnapshot` | Simulation frame counter. |
| `writerUid` | string \| null | Optional | `writeStateSnapshot` | Currently elected host writer. |
| `lastWriter` | string \| null | Optional | `writeStateSnapshot` | Mirror of `writerUid` for auditing. |
| `ts` | number (ms since epoch) | Required | `writeStateSnapshot` | Wall-clock snapshot time. |
| `lastUpdate` | server timestamp | Required | `writeArenaState` | Firestore server clock for latency diagnostics. |
| `entities` | map<string, ArenaEntityState> | Required | `writeStateSnapshot` | Per-presence fighter state keyed by presence id. |

`ArenaEntityState` structure:

| Field | Type | Required / Default | Notes |
| --- | --- | --- | --- |
| `x`, `y` | number | Required | World position in pixels. |
| `vx`, `vy` | number | Required | Velocity in pixels/second. |
| `facing` | `"L"` \| `"R"` | Required | Horizontal orientation. |
| `hp` | number | Required | Clamped 0–100 hit points. |
| `name` | string | Optional | Debug display name. |
| `attackActiveUntil` | number | Optional | Millisecond timestamp for active hitbox. |
| `canAttackAt` | number | Optional | Millisecond timestamp when next attack is allowed. |
| `updatedAt` | server timestamp | Required | Set on every merge write. |

##### Example state frame
```json
{
  "tick": 128,
  "writerUid": "u123",
  "lastWriter": "u123",
  "ts": 1713400012000,
  "lastUpdate": { "__datatype__": "serverTimestamp" },
  "entities": {
    "pres-abc": {
      "x": 512,
      "y": 128,
      "vx": 4,
      "vy": 0,
      "facing": "R",
      "hp": 85,
      "attackActiveUntil": 1713400012500,
      "canAttackAt": 1713400013000,
      "updatedAt": { "__datatype__": "serverTimestamp" }
    }
  }
}
```

#### arenas/{arenaId}/seats/{seatNo}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `playerId` | string | Required | `claimArenaSeat` (UI) | Bound to lobby player occupying the slot. |
| `uid` | string | Required | `claimArenaSeat` (UI) | Firebase auth UID for seat owner. |
| `profileId` | string | Optional | `claimArenaSeat` (UI) | Cross-reference to persistent profile when available. |
| `codename` | string | Optional | `claimArenaSeat` (UI) | Short alias shown on overlays. |
| `displayName` | string | Optional | `claimArenaSeat` (UI) | Friendly name resolved from profile or player doc. |
| `joinedAt` | server timestamp | Optional | `watchArenaSeats` | Captures seat acquisition time. |

## players/{playerId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `codename` | string | Required | `createPlayer` | Unique handle chosen during onboarding. |
| `displayName` | string \| null | Optional | `loginWithPasscode` normalization | Preferred display label; trimmed when present. |
| `name` | string \| null | Optional | Legacy field migrated to `displayName`. |
| `createdAt` | server timestamp | Required | `createPlayer` | First-seen audit. |
| `lastActiveAt` | server timestamp | Required | `createPlayer` / `updatePlayerActivity` | Updated when players interact. |

## passcodes/{passcode}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `playerId` | string | Required | `createPlayer` | Foreign key into `players`. |
| `createdAt` | server timestamp | Required | `createPlayer` | Issued alongside player creation. |

## boss/{docId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `displayName` | string | Required | `ensureBossProfile` | Marketing / announcer identity. |
| `createdAt` | ISO date string | Required | `ensureBossProfile` | Stored as ISO string for deterministic renders. |

## leaderboard/{playerId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `playerId` | string | Required | `recordLeaderboardWin` | Mirror of document id for security checks. |
| `playerCodename` | string | Optional | `recordLeaderboardWin` | Cached codename to avoid fan-out reads. |
| `wins` | number | Defaults to `0` | `recordLeaderboardWin` | Incremented per win via atomic counter. |
| `losses` | number | Defaults to `0` | `deserializeLeaderboardEntry` | Present when loss tracking is implemented. |
| `streak` | number | Defaults to `0` | `recordLeaderboardWin` | Incremented alongside wins; reset handled server-side. |
| `updatedAt` | server timestamp | Required | `recordLeaderboardWin` | Last update time for leaderboard ordering. |
| `lastWinAt` | server timestamp | Optional | `recordLeaderboardWin` | Used as secondary sort key. |

## meta/{docId}

| Field | Type | Required / Default | Authoritative Source | Notes & Invariants |
| --- | --- | --- | --- | --- |
| `…` | varies | Read-only | Static site metadata | Configured manually; writes disabled by security rules. |

## Security Rules Matrix

| Path | Read | Write | Notes |
| --- | --- | --- | --- |
| `/arenas/{arenaId}` | Public | Authenticated | Arena metadata legible to everyone; admins seed via client. |
| `/arenas/{arenaId}/state/{docId}` | Public | Authenticated | Host-elected clients stream authoritative state. |
| `/arenas/{arenaId}/presence/{presenceId}` | Public | Owner only (create/update/delete) | `authUid` immutable and must match `request.auth.uid`. |
| `/arenas/{arenaId}/inputs/{presenceId}` | Public | Authenticated | Aggregate docs enforced through security matching `authUid`. |
| `/arenas/{arenaId}/inputs/{presenceId}/events/{eventId}` | Public | Owner-only create | Event writes require matching `authUid` and `presenceId`. |
| `/players/{playerId}` | Authenticated | Authenticated | Admin console operates with signed-in users. |
| `/passcodes/{passcode}` | Authenticated | Authenticated | Passcode issuance limited to signed-in staff. |
| `/boss/{doc}` | Authenticated | Authenticated | Controlled via admin tooling. |
| `/leaderboard/{entry}` | Authenticated | None | Leaderboard is append-only from trusted backend. |
| `/meta/{doc}` | Public | None | Static configuration; client is read-only. |

## Indexes

| Collection Group | Index Definition | Rationale |
| --- | --- | --- |
| `actions` | `arenaId` ASC, `createdAt` ASC | Supports chronological review of gameplay events per arena in admin tooling. |
| `leaderboard` | `wins` DESC, `lastWinAt` DESC | Powers ranked leaderboard queries sorted by wins and recency. |

## App Check Posture

- Web clients initialize Firebase App Check with either reCAPTCHA v3 or reCAPTCHA Enterprise based on `VITE_APPCHECK_PROVIDER`.
- Initialization requires `VITE_APPCHECK_SITE_KEY`; when absent (common in local builds) initialization is skipped after logging a warning.
- Development builds register the debug App Check token automatically when running in browser contexts (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`).

## Active Authentication Flows

- **Anonymous bootstrap**: All entry points call `ensureAnonAuth()` which signs users in anonymously and caches the Firebase Auth user for subsequent reads/writes.
- **Passcode login**: The admin console exposes `loginWithPasscode`, resolving `/passcodes/{code}` to `/players/{playerId}` and storing the associated player profile for personalized presence and roster labels.

