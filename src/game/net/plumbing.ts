import { auth, fetchArenaInputs, writeArenaState, type ArenaInputSnapshot, type ArenaStateWrite } from "../../firebase";
import type { LivePresence } from "../../firebase";

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
  displayName: string;
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

interface ArenaSimContext {
  fighters: Map<string, FighterState>;
  inputs: Map<string, InputCommand>;
  presenceIndex: Map<string, PresenceInfo>;
  tick: number;
  spawnCursor: number;
}

const contexts = new Map<string, ArenaSimContext>();

const ensureContext = (arenaId: string): ArenaSimContext => {
  let ctx = contexts.get(arenaId);
  if (!ctx) {
    ctx = {
      fighters: new Map(),
      inputs: new Map(),
      presenceIndex: new Map(),
      tick: 0,
      spawnCursor: 0,
    };
    contexts.set(arenaId, ctx);
  }
  return ctx;
};

const nextSpawn = (ctx: ArenaSimContext) => {
  const point = SPAWN_POINTS[ctx.spawnCursor % SPAWN_POINTS.length];
  ctx.spawnCursor += 1;
  return { ...point };
};

const syncPresence = (ctx: ArenaSimContext, live: LivePresence[]) => {
  const now = Date.now();
  const active = new Set<string>();

  for (const entry of live) {
    const presenceId = entry.id;
    const authUid = entry.authUid;
    if (!presenceId || !authUid) continue;

    const lastSeenMs = Number.isFinite(entry.lastSeen) ? entry.lastSeen : now;
    active.add(presenceId);
    ctx.presenceIndex.set(presenceId, {
      presenceId,
      authUid,
      lastSeenMs,
      displayName: entry.displayName,
    });

    const existing = ctx.fighters.get(presenceId);
    const name = entry.displayName ?? authUid.slice(0, 6);
    if (existing) {
      existing.lastSeenMs = lastSeenMs;
      existing.name = name;
      existing.authUid = authUid;
      continue;
    }

    const spawn = nextSpawn(ctx);
    ctx.fighters.set(presenceId, {
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
  }

  for (const [presenceId] of ctx.fighters) {
    if (!active.has(presenceId)) {
      ctx.fighters.delete(presenceId);
      ctx.inputs.delete(presenceId);
      ctx.presenceIndex.delete(presenceId);
    }
  }
};

const applyInputs = (ctx: ArenaSimContext, snapshots: ArenaInputSnapshot[]) => {
  const seen = new Set<string>();

  for (const snapshot of snapshots) {
    const presenceId = snapshot.presenceId;
    if (!presenceId) continue;
    if (!ctx.presenceIndex.has(presenceId)) continue;

    const previous = ctx.inputs.get(presenceId);
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

    ctx.inputs.set(presenceId, command);
    seen.add(presenceId);
  }

  for (const key of [...ctx.inputs.keys()]) {
    if (!seen.has(key)) {
      const prev = ctx.inputs.get(key);
      ctx.inputs.set(key, {
        ...DEFAULT_COMMAND,
        attackSeq: prev?.attackSeq ?? DEFAULT_COMMAND.attackSeq,
        codename: prev?.codename,
      });
    }
  }
};

const integrate = (ctx: ArenaSimContext, dt: number) => {
  const now = Date.now();

  for (const fighter of ctx.fighters.values()) {
    const command = ctx.inputs.get(fighter.presenceId) ?? DEFAULT_COMMAND;

    const horizontal = command.left === command.right ? 0 : command.left ? -1 : 1;
    fighter.vx = horizontal * MOVE_SPEED;
    fighter.x += fighter.vx * dt;

    if (fighter.x < MIN_X) fighter.x = MIN_X;
    else if (fighter.x > MAX_X) fighter.x = MAX_X;

    if (fighter.vx < 0) fighter.facing = "L";
    else if (fighter.vx > 0) fighter.facing = "R";

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

  for (const fighter of ctx.fighters.values()) {
    if (fighter.attackActiveUntilMs <= now) continue;

    for (const target of ctx.fighters.values()) {
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
    }
  }

  ctx.tick += 1;
};

export const pullAllInputs = async (arenaId: string) => {
  return fetchArenaInputs(arenaId);
};

export const stepSimFrame = (
  arenaId: string,
  dtMs: number,
  inputs: ArenaInputSnapshot[],
  live: LivePresence[],
) => {
  const ctx = ensureContext(arenaId);
  syncPresence(ctx, live);
  applyInputs(ctx, inputs);
  integrate(ctx, dtMs / 1000);
};

export const writeStateSnapshot = async (arenaId: string) => {
  const ctx = ensureContext(arenaId);
  const entities: ArenaStateWrite["entities"] = {};

  for (const fighter of ctx.fighters.values()) {
    entities[fighter.presenceId] = {
      x: fighter.x,
      y: fighter.y,
      vx: fighter.vx,
      vy: fighter.vy,
      facing: fighter.facing,
      hp: fighter.hp,
      name: fighter.name,
      attackActiveUntil: fighter.attackActiveUntilMs,
      canAttackAt: fighter.nextAttackAllowedAtMs,
    };
  }

  const snapshot: ArenaStateWrite = {
    tick: ctx.tick,
    writerUid: auth.currentUser?.uid ?? null,
    lastWriter: auth.currentUser?.uid ?? null,
    ts: Date.now(),
    entities,
  };

  await writeArenaState(arenaId, snapshot);
};

export const resetArenaSim = (arenaId: string) => {
  contexts.delete(arenaId);
};
