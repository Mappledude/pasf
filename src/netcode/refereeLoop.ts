import type { InputIntent, Snapshot } from "../types/netcode";
import { nowMs } from "../utils/time";
import {
  getInputsForTick,
  getLatestSnapshot,
  subscribeMatch,
  writeSnapshot,
} from "./refereeStore";

const DT = 0.05;
const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const GROUND_HEIGHT = 40;
const PLAYER_WIDTH = 28;
const PLAYER_HEIGHT = 48;
const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2;
const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2;
const GROUND_Y = WORLD_HEIGHT - GROUND_HEIGHT - PLAYER_HALF_HEIGHT;
const CEILING_Y = PLAYER_HALF_HEIGHT;
const GRAVITY = 900;
const MOVE_ACCEL = 1200;
const MAX_SPEED = 240;
const GROUND_FRICTION = 900;
const AIR_FRICTION = 200;
const JUMP_SPEED = 420;
const MIN_SEPARATION = 36;
const ATTACK_OFFSET = 28;
const ATTACK_RANGE = 40;
const ATTACK_HEIGHT = 60;
const ATTACK_DURATION = 0.12;
const ATTACK_COOLDOWN = 0.25;
const DAMAGE = 10;

interface PlayerMeta {
  attackTimer: number;
  attackCooldown: number;
  attackConsumed: boolean;
  prevAttack: boolean;
  prevJump: boolean;
  facing: 1 | -1;
}

interface SnapshotMeta {
  p1: PlayerMeta;
  p2: PlayerMeta;
}

const snapshotMeta = new WeakMap<Snapshot, SnapshotMeta>();

function makePlayerMeta(): PlayerMeta {
  return {
    attackTimer: 0,
    attackCooldown: 0,
    attackConsumed: false,
    prevAttack: false,
    prevJump: false,
    facing: 1,
  };
}

function makeSnapshotMeta(): SnapshotMeta {
  return { p1: makePlayerMeta(), p2: makePlayerMeta() };
}

function ensureMeta(snapshot: Snapshot): SnapshotMeta {
  let meta = snapshotMeta.get(snapshot);
  if (!meta) {
    meta = makeSnapshotMeta();
    snapshotMeta.set(snapshot, meta);
  }
  return meta;
}

function approachZero(value: number, delta: number) {
  if (value > 0) {
    return Math.max(0, value - delta);
  }
  if (value < 0) {
    return Math.min(0, value + delta);
  }
  return 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function createInitialSnapshot(): Snapshot {
  const snapshot: Snapshot = {
    t: 0,
    p1: { x: 240, y: GROUND_Y, vx: 0, vy: 0, hp: 100 },
    p2: { x: 720, y: GROUND_Y, vx: 0, vy: 0, hp: 100 },
    events: [],
    ts: nowMs(),
  };
  snapshotMeta.set(snapshot, makeSnapshotMeta());
  return snapshot;
}

function updateFacing(meta: PlayerMeta, input: InputIntent | undefined, selfX: number, otherX: number) {
  if (input?.left && !input.right) {
    meta.facing = -1;
  } else if (input?.right && !input.left) {
    meta.facing = 1;
  } else if (Math.abs(selfX - otherX) > 2) {
    meta.facing = selfX < otherX ? 1 : -1;
  }
}

function handleAttack(
  attacker: { state: Snapshot["p1"]; meta: PlayerMeta },
  defender: { state: Snapshot["p1"]; meta: PlayerMeta },
  events: string[],
  defenderLabel: "p1" | "p2",
) {
  if (attacker.meta.attackTimer <= 0 || attacker.meta.attackConsumed) {
    return;
  }
  const hitX = attacker.state.x + attacker.meta.facing * ATTACK_OFFSET;
  const dx = Math.abs(hitX - defender.state.x);
  const dy = Math.abs(attacker.state.y - defender.state.y);
  if (dx <= ATTACK_RANGE && dy <= ATTACK_HEIGHT) {
    attacker.meta.attackConsumed = true;
    defender.state.hp = Math.max(0, defender.state.hp - DAMAGE);
    events.push(`${defenderLabel}:hit`);
    if (defender.state.hp <= 0) {
      defender.state.hp = 100;
      events.push(`${defenderLabel}:ko`);
    }
  }
}

function stepPlayer(
  current: Snapshot["p1"],
  input: InputIntent | undefined,
  meta: PlayerMeta,
): Snapshot["p1"] {
  let vx = current.vx;
  let vy = current.vy;
  const onGround = current.y >= GROUND_Y - 0.5;
  vy += GRAVITY * DT;

  if (input?.left && !input.right) {
    vx -= MOVE_ACCEL * DT;
  } else if (input?.right && !input.left) {
    vx += MOVE_ACCEL * DT;
  } else {
    const friction = onGround ? GROUND_FRICTION : AIR_FRICTION;
    vx = approachZero(vx, friction * DT);
  }

  const wantsJump = (input?.jump || input?.up) ?? false;
  if (wantsJump && !meta.prevJump && onGround) {
    vy = -JUMP_SPEED;
  }
  meta.prevJump = wantsJump;

  if (meta.attackCooldown > 0) {
    meta.attackCooldown = Math.max(0, meta.attackCooldown - DT);
  }
  if (meta.attackTimer > 0) {
    meta.attackTimer = Math.max(0, meta.attackTimer - DT);
    if (meta.attackTimer === 0) {
      meta.attackConsumed = false;
    }
  }

  const attackHeld = !!input?.attack;
  if (attackHeld && !meta.prevAttack && meta.attackCooldown <= 0) {
    meta.attackTimer = ATTACK_DURATION;
    meta.attackCooldown = ATTACK_COOLDOWN;
    meta.attackConsumed = false;
  }
  meta.prevAttack = attackHeld;

  vx = clamp(vx, -MAX_SPEED, MAX_SPEED);

  let nx = current.x + vx * DT;
  let ny = current.y + vy * DT;

  if (ny >= GROUND_Y) {
    ny = GROUND_Y;
    vy = 0;
  } else if (ny <= CEILING_Y) {
    ny = CEILING_Y;
    vy = 0;
  }

  nx = clamp(nx, PLAYER_HALF_WIDTH, WORLD_WIDTH - PLAYER_HALF_WIDTH);

  return { x: nx, y: ny, vx, vy, hp: current.hp };
}

export function applyRules(
  prev: Snapshot,
  inputs: { p1?: InputIntent; p2?: InputIntent },
): Snapshot {
  const prevMeta = ensureMeta(prev);
  const nextMeta: SnapshotMeta = {
    p1: { ...prevMeta.p1 },
    p2: { ...prevMeta.p2 },
  };

  updateFacing(nextMeta.p1, inputs.p1, prev.p1.x, prev.p2.x);
  updateFacing(nextMeta.p2, inputs.p2, prev.p2.x, prev.p1.x);

  const nextP1 = stepPlayer(prev.p1, inputs.p1, nextMeta.p1);
  const nextP2 = stepPlayer(prev.p2, inputs.p2, nextMeta.p2);

  let dx = nextP2.x - nextP1.x;
  const separation = Math.abs(dx);
  if (separation < MIN_SEPARATION && separation > 0) {
    const push = (MIN_SEPARATION - separation) / 2;
    const direction = dx >= 0 ? -1 : 1;
    nextP1.x = clamp(nextP1.x + direction * push, PLAYER_HALF_WIDTH, WORLD_WIDTH - PLAYER_HALF_WIDTH);
    nextP2.x = clamp(nextP2.x - direction * push, PLAYER_HALF_WIDTH, WORLD_WIDTH - PLAYER_HALF_WIDTH);
    dx = nextP2.x - nextP1.x;
  }

  const events: string[] = [];

  handleAttack({ state: nextP1, meta: nextMeta.p1 }, { state: nextP2, meta: nextMeta.p2 }, events, "p2");
  handleAttack({ state: nextP2, meta: nextMeta.p2 }, { state: nextP1, meta: nextMeta.p1 }, events, "p1");

  const snapshot: Snapshot = {
    t: prev.t + 1,
    p1: nextP1,
    p2: nextP2,
    events: events.length ? events : undefined,
    ts: nowMs(),
  };
  snapshotMeta.set(snapshot, nextMeta);
  return snapshot;
}

export function startRefereeLoop(
  matchId: string,
  opts: { onTick?: (t: number) => void } = {},
): () => void {
  let disposed = false;
  let ticking = false;
  let latestSnapshot: Snapshot | null = null;
  let initialized = false;

  const initPromise = (async () => {
    const existing = await getLatestSnapshot(matchId);
    if (existing) {
      latestSnapshot = existing;
      ensureMeta(existing);
    } else {
      latestSnapshot = createInitialSnapshot();
      await writeSnapshot(matchId, latestSnapshot.t, latestSnapshot);
    }
    initialized = true;
  })();

  const unsubscribeMatch = subscribeMatch(matchId, (match) => {
    if (latestSnapshot && match.tick > latestSnapshot.t) {
      getLatestSnapshot(matchId)
        .then((snap) => {
          if (snap) {
            latestSnapshot = snap;
            ensureMeta(snap);
          }
        })
        .catch((err) => console.warn("[refereeLoop] refresh snapshot failed", err));
    }
  });

  const interval = setInterval(() => {
    if (disposed || ticking || !initialized || !latestSnapshot) return;
    ticking = true;
    const nextTick = latestSnapshot.t + 1;
    getInputsForTick(matchId, nextTick)
      .then((inputs) => {
        const snap = applyRules(latestSnapshot!, inputs);
        latestSnapshot = snap;
        return writeSnapshot(matchId, snap.t, snap).then(() => {
          opts.onTick?.(snap.t);
        });
      })
      .catch((err) => {
        console.warn("[refereeLoop] tick failed", err);
      })
      .finally(() => {
        ticking = false;
      });
  }, 50);

  return () => {
    disposed = true;
    clearInterval(interval);
    unsubscribeMatch();
    void initPromise;
  };
}
