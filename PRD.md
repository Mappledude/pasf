# Product Requirements Document: Multiplayer Stick-Figure Fighting Game MVP

## Introduction
Deliver a fast-paced online stick-figure arena brawler MVP that supports quick three-minute matches for up to six players on PC with cross-platform-ready architecture.

## Audience & Scope
Primary audience is competitive action players aged 13-30 on Windows and macOS via Steam Early Access distribution, with scope limited to three arenas, four weapon loadouts, and no cosmetic store at launch.

## Core Gameplay Loop
Players join matchmaking, customize one of four stick fighters, battle through best-of-five rounds with environmental hazards, trigger a co-op boss wave every third match, and receive match-end rewards that feed into ranked progression.

## Player Management
Accounts authenticate through Steam, use lightweight profiles storing MMR, loadouts, and unlockable emotes, and include party support for up to four friends with automated matchmaking and reporting for afk or toxic behavior.

## Networking Model
Authoritative dedicated servers run in North American and European regions using client-side prediction with deterministic rollback for combat resolution, while relay servers cover peer connections in high-latency cases.

## Controls
Keyboard default mapping uses WASD for movement, J/K for light and heavy attacks, L for block, and Space for dash, while controllers map to left stick movement, X/Y for attacks, B for block, and right trigger for dash, with fully remappable bindings.

## Success Metrics
Launch KPIs include 10,000 DAU, 70% day-one retention, 200 concurrent matches sustained, sub-100ms median input latency, and less than 0.5% crash rate per session.

## Analytics & Reporting
Integrate realtime telemetry capturing matchmaking funnel, match duration, latency, disconnect rate, and boss encounter completion, with dashboards refreshing hourly and weekly emailed health summaries.

## Roadmap Notes
Post-MVP roadmap tracks ranked seasons, console ports, clan tournaments, boss variation drops, cosmetic monetization, and in-game replay sharing.
