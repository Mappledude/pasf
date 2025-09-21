import {
  watchArenaInputs,
  watchArenaPresence,
  writeArenaState,
  type ArenaInputSnapshot,
} from "../../firebase";
import type { ArenaPresenceEntry } from "../../types/models";

export interface HostLoopOptions {
  arenaId: string;
  writerAuthUid: string;
  writerPresenceId: string;
  tickRateHz?: number;
  log?: typeof console;
}

export interface HostLoopController {
  stop(): void;
}

const DEFAULT_TICK_RATE = 12;
const MOVE_SPEED = 240; // px/s
const GRAVITY = 1_200; // px/s^2
const JUMP_VELOCITY = -420; // px/s (negative = upward)
const FLOOR_Y = 540 - 40 - 60;
const MIN_X = 60;
const MAX_X = 900;
const ATTACK_RANGE_X = 80;
const ATTACK_RANGE_Y = 60;
const ATTACK_DAMAGE = 10;
const ATTACK_DURATION_MS = 140;
const ATTACK_COOLDOWN_MS = 320;

const ONLINE_WINDOW_MS = 20_000;

interface FighterState {
  presenceId: string;
  authUid: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: "L" | "R";
  hp: number;
  name?: string;
  lastSeenMs: number;
  attackActiveUntilMs: number;
  nextAttackAllowedAtMs: number;
  lastAttackSeq: number;
  hitTargets: Set<string>;
}

interface PresenceInfo {
  presenceId: string;
  authUid: string;
  lastSeenMs: number;
  entry: ArenaPresenceEntry;
}

interface InputCommand {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
  codename?: string;
  attackSeq?: number;
}

const DEFAULT_COMMAND: InputCommand = {
  left: false,
  right: false,
  jump: false,
  attack: false,
  attackSeq: 0,
};

const SPAWN_POINTS = [
  { x: 240, y: FLOOR_Y, facing: "R" as const },
  { x: 720, y: FLOOR_Y, facing: "L" as const },
  { x: 480, y: FLOOR_Y, facing: "R" as const },
  { x: 120, y: FLOOR_Y, facing: "R" as const },
];

export function startHostLoop(options: HostLoopOptions): HostLoopController {
  const tickRate = options.tickRateHz ?? DEFAULT_TICK_RATE;
  const intervalMs = Math.max(1, Math.round(1000 / tickRate));
  const logger = options.log ?? console;

  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let tick = 0;
  let spawnCursor = 0;
  const fighters = new Map<string, FighterState>();
  const inputs = new Map<string, InputCommand>();
  const presenceIndex = new Map<string, PresenceInfo>();
  let presenceUnsub: (() => void) | null = null;
  let inputsUnsub: (() => void) | null = null;

  const nextSpawn = () => {
    const point = SPAWN_POINTS[spawnCursor % SPAWN_POINTS.length];
    spawnCursor += 1;
    return { ...point };
  };

  const handlePresence = (entries: ArenaPresenceEntry[]) => {
    if (stopped) return;
    const now = Date.now();
    const active = new Set<string>();
    for (const entry of entries) {
      const presenceId = entry.presenceId ?? entry.playerId;
      const authUid = entry.authUid ?? entry.playerId;
      if (!presenceId || !authUid) continue;
      const parsedLastSeen = entry.lastSeen ? Date.parse(entry.lastSeen) : Number.NaN;
      const lastSeenMs = Number.isFinite(parsedLastSeen) ? parsedLastSeen : Number.NaN;
      if (!Number.isFinite(lastSeenMs)) continue;
      if (now - lastSeenMs > ONLINE_WINDOW_MS) continue;

      active.add(presenceId);
      presenceIndex.set(presenceId, { presenceId, authUid, lastSeenMs, entry });
      const existing = fighters.get(presenceId);
      const name = entry.codename ?? entry.displayName ?? authUid.slice(0, 6);
      if (existing) {
        existing.lastSeenMs = lastSeenMs;
        existing.name = name;
        existing.authUid = authUid;
        continue;
      }
      const spawn = nextSpawn();
      fighters.set(presenceId, {
        presenceId,
        authUid,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        facing: spawn.facing,
        hp: 100,
        name,
        lastSeenMs,
        attackActiveUntilMs: 0,
        nextAttackAllowedAtMs: 0,
        lastAttackSeq: 0,
        hitTargets: new Set(),
      });
      logger.info?.(`[SPAWN] presence=${presenceId} auth=${authUid} name="${name}"`);
    }

    for (const [presenceId] of fighters) {
      if (!active.has(presenceId)) {
        fighters.delete(presenceId);
        inputs.delete(presenceId);
        presenceIndex.delete(presenceId);
        logger.info?.(`[DESPAWN] presence=${presenceId}`);
      }
    }
  };

  const handleInputs = (snapshots: ArenaInputSnapshot[]) => {
    if (stopped) return;
    const seen = new Set<string>();
    for (const snapshot of snapshots) {
      const presenceId = snapshot.presenceId;
      if (!presenceId) {
        continue;
      }
      const info = presenceIndex.get(presenceId);
      if (!info) {
        logger.info?.(`[INPUT] rejected {presenceId=${presenceId}, reason=presence_offline}`);
        continue;
      }
      if (!snapshot.authUid) {
        logger.info?.(`[INPUT] rejected {presenceId=${presenceId}, reason=missing_auth}`);
        continue;
      }
      if (snapshot.authUid !== info.authUid) {
        logger.info?.(`[INPUT] rejected {presenceId=${presenceId}, reason=auth_mismatch}`);
        continue;
      }

      const previous = inputs.get(presenceId);
      const attackSeq =
        typeof snapshot.attackSeq === "number"
          ? snapshot.attackSeq
          : previous?.attackSeq ?? DEFAULT_COMMAND.attackSeq;
      const command: InputCommand = {
        left: !!snapshot.left,
        right: !!snapshot.right,
        jump: !!snapshot.jump,
        attack: !!snapshot.attack,
        attackSeq,
        codename: snapshot.codename,
      };
      inputs.set(presenceId, command);
      seen.add(presenceId);
    }
    for (const key of [...inputs.keys()]) {
      if (!seen.has(key)) {
        const prev = inputs.get(key);
        inputs.set(key, {
          ...DEFAULT_COMMAND,
          attackSeq: prev?.attackSeq ?? DEFAULT_COMMAND.attackSeq,
          codename: prev?.codename,
        });
      }
    }
    logger.info?.(
      `[INPUT] count=${snapshots.length} presences=${snapshots
        .map((snap) => snap.presenceId)
        .join(",")}`,
    );
  };

  const step = async () => {
    if (stopped || busy) {
      return;
    }
    busy = true;
    try {
      const dt = intervalMs / 1000;
      const now = Date.now();
      for (const fighter of fighters.values()) {
        const command = inputs.get(fighter.presenceId) ?? DEFAULT_COMMAND;
        const horizontal = command.left === command.right ? 0 : command.left ? -1 : 1;
        fighter.vx = horizontal * MOVE_SPEED;
        fighter.x += fighter.vx * dt;
        if (fighter.x < MIN_X) {
          fighter.x = MIN_X;
        } else if (fighter.x > MAX_X) {
          fighter.x = MAX_X;
        }
        if (fighter.vx < 0) {
          fighter.facing = "L";
        } else if (fighter.vx > 0) {
          fighter.facing = "R";
        }

        const onGround = Math.abs(fighter.y - FLOOR_Y) < 1 && fighter.vy === 0;
        if (command.jump && onGround) {
          fighter.vy = JUMP_VELOCITY;
        }
        fighter.vy += GRAVITY * dt;
        fighter.y += fighter.vy * dt;
        if (fighter.y >= FLOOR_Y) {
          fighter.y = FLOOR_Y;
          fighter.vy = 0;
        }

        if (command.codename && command.codename !== fighter.name) {
          fighter.name = command.codename;
        }

        const attackSeq =
          typeof command.attackSeq === "number" ? command.attackSeq : fighter.lastAttackSeq;
        if (typeof attackSeq === "number") {
          if (attackSeq > fighter.lastAttackSeq) {
            if (now >= fighter.nextAttackAllowedAtMs) {
              fighter.attackActiveUntilMs = now + ATTACK_DURATION_MS;
              fighter.nextAttackAllowedAtMs = now + ATTACK_COOLDOWN_MS;
              fighter.hitTargets.clear();
              logger.info?.(
                `[ATTACK] presence=${fighter.presenceId} auth=${fighter.authUid} seq=${attackSeq}`,
              );
            }
            fighter.lastAttackSeq = attackSeq;
          } else if (attackSeq < fighter.lastAttackSeq) {
            fighter.lastAttackSeq = attackSeq;
          }
        }

        if (fighter.attackActiveUntilMs <= now) {
          fighter.hitTargets.clear();
        }
      }

      for (const fighter of fighters.values()) {
        if (fighter.attackActiveUntilMs <= now) {
          continue;
        }
        for (const target of fighters.values()) {
          if (target.presenceId === fighter.presenceId) continue;
          if (fighter.hitTargets.has(target.presenceId)) continue;
          if (target.hp <= 0) continue;

          const dx = target.x - fighter.x;
          const dy = target.y - fighter.y;
          const direction = fighter.facing === "L" ? -1 : 1;
          if (dx * direction <= 0) continue;
          if (Math.abs(dx) > ATTACK_RANGE_X) continue;
          if (Math.abs(dy) > ATTACK_RANGE_Y) continue;

          target.hp = Math.max(0, target.hp - ATTACK_DAMAGE);
          fighter.hitTargets.add(target.presenceId);
          logger.info?.(
            `[HIT] attacker=${fighter.presenceId} target=${target.presenceId} hp=${target.hp} damage=${ATTACK_DAMAGE}`,
          );
        }
      }

      tick += 1;

      const ts = Date.now();
      const snapshot = {
        tick,
        writerUid: options.writerAuthUid,
        lastWriter: options.writerAuthUid,
        ts,
        entities: Object.fromEntries(
          [...fighters.entries()].map(([presenceId, fighter]) => [
            presenceId,
            {
              x: fighter.x,
              y: fighter.y,
              vx: fighter.vx,
              vy: fighter.vy,
              facing: fighter.facing,
              hp: fighter.hp,
              name: fighter.name,
              attackActiveUntil: fighter.attackActiveUntilMs,
              canAttackAt: fighter.nextAttackAllowedAtMs,
            },
          ]),
        ),
      } satisfies Parameters<typeof writeArenaState>[1];

      await writeArenaState(options.arenaId, snapshot);
      logger.info?.(`[ARENA] writer=${options.writerAuthUid} tick=${tick}`);
      logger.info?.(`[STATE] entities=${fighters.size}`);
    } catch (error) {
      logger.error?.("[hostLoop] step error", error);
    } finally {
      busy = false;
    }
  };

  presenceUnsub = watchArenaPresence(options.arenaId, handlePresence);
  inputsUnsub = watchArenaInputs(options.arenaId, handleInputs);

  timer = setInterval(() => {
    void step();
  }, intervalMs);

  logger.info?.("[hostLoop] started", {
    arenaId: options.arenaId,
    tickRate,
    writerAuthUid: options.writerAuthUid,
    writerPresenceId: options.writerPresenceId,
  });

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      fighters.clear();
      inputs.clear();
      if (presenceUnsub) {
        presenceUnsub();
        presenceUnsub = null;
      }
      if (inputsUnsub) {
        inputsUnsub();
        inputsUnsub = null;
      }
      presenceIndex.clear();
      logger.info?.("[hostLoop] stopped", { arenaId: options.arenaId });
    },
  };
}
