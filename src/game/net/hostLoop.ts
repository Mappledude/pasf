import {
  watchArenaInputs,
  watchArenaPresence,
  writeArenaState,
  type ArenaInputSnapshot,
} from "../../firebase";
import type { ArenaPresenceEntry } from "../../types/models";

export interface HostLoopOptions {
  arenaId: string;
  writerUid: string;
  tickRateHz?: number;
  log?: typeof console;
}

export interface HostLoopController {
  stop(): void;
}

const DEFAULT_TICK_RATE = 11;
const ACTIVE_WINDOW_MS = 20_000;
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

interface FighterState {
  uid: string;
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
      const uid = entry.authUid ?? entry.playerId;
      if (!uid) continue;
      const lastSeenMs = entry.lastSeen ? Date.parse(entry.lastSeen) : NaN;
      if (!Number.isFinite(lastSeenMs)) {
        continue;
      }
      if (now - lastSeenMs > ACTIVE_WINDOW_MS) {
        continue;
      }
      active.add(uid);
      const existing = fighters.get(uid);
      const name = entry.codename ?? entry.displayName ?? uid.slice(0, 6);
      if (existing) {
        existing.lastSeenMs = lastSeenMs;
        existing.name = name;
        continue;
      }
      const spawn = nextSpawn();
      fighters.set(uid, {
        uid,
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
      logger.info?.(`[SPAWN] uid=${uid} name="${name}"`);
    }

    for (const [uid, fighter] of fighters) {
      if (!active.has(uid)) {
        fighters.delete(uid);
        logger.info?.(`[DESPAWN] uid=${uid}`);
      }
    }
  };

  const handleInputs = (snapshots: ArenaInputSnapshot[]) => {
    if (stopped) return;
    const seen = new Set<string>();
    for (const snapshot of snapshots) {
      const uid = snapshot.playerId;
      if (!uid) continue;
      const previous = inputs.get(uid);
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
      inputs.set(uid, command);
      seen.add(uid);
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
      `[INPUT] count=${snapshots.length} uids=${snapshots.map((snap) => snap.playerId).join(",")}`,
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
        const command = inputs.get(fighter.uid) ?? DEFAULT_COMMAND;
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
              logger.info?.(`[ATTACK] uid=${fighter.uid} seq=${attackSeq}`);
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
          if (target.uid === fighter.uid) continue;
          if (fighter.hitTargets.has(target.uid)) continue;
          if (target.hp <= 0) continue;

          const dx = target.x - fighter.x;
          const dy = target.y - fighter.y;
          const direction = fighter.facing === "L" ? -1 : 1;
          if (dx * direction <= 0) continue;
          if (Math.abs(dx) > ATTACK_RANGE_X) continue;
          if (Math.abs(dy) > ATTACK_RANGE_Y) continue;

          target.hp = Math.max(0, target.hp - ATTACK_DAMAGE);
          fighter.hitTargets.add(target.uid);
          logger.info?.(
            `[HIT] attacker=${fighter.uid} target=${target.uid} hp=${target.hp} damage=${ATTACK_DAMAGE}`,
          );
        }
      }

      tick += 1;

      const snapshot = {
        tick,
        writerUid: options.writerUid,
        entities: Object.fromEntries(
          [...fighters.entries()].map(([uid, fighter]) => [
            uid,
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
      logger.info?.(`[STATE] tick=${tick} entities=${fighters.size}`);
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

  logger.info?.("[hostLoop] started", { arenaId: options.arenaId, tickRate });

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
      logger.info?.("[hostLoop] stopped", { arenaId: options.arenaId });
    },
  };
}
