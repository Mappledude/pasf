import type { InputIntent, PlayerState, Snapshot } from "../types/netcode";
import { getInputsForTick, writeSnapshot } from "./refereeStore";

const DT = 0.05;
const GRAV = 900;
const GROUND_Y = 540 - 40;
const MOVE = 220;
const JUMP_VY = -420;
const MAX_VX = 320;

function stepOne(p: PlayerState, input?: InputIntent): PlayerState {
  let vx = p.vx;
  let vy = p.vy;
  let x = p.x;
  let y = p.y;
  let hp = p.hp;

  if (input?.left && !input?.right) vx = -MOVE;
  else if (input?.right && !input?.left) vx = MOVE;
  else vx = 0;

  const onGround = y >= GROUND_Y;
  if (input?.jump && onGround) vy = JUMP_VY;

  vy += GRAV * DT;
  x += vx * DT;
  y += vy * DT;

  if (y > GROUND_Y) {
    y = GROUND_Y;
    vy = 0;
  }

  if (vx > MAX_VX) vx = MAX_VX;
  if (vx < -MAX_VX) vx = -MAX_VX;

  return { x, y, vx, vy, hp };
}

function resolveAttacks(p1: PlayerState, p2: PlayerState, i1?: InputIntent, i2?: InputIntent) {
  const near = Math.abs(p1.x - p2.x) < 40 && Math.abs(p1.y - p2.y) < 12;
  const events: string[] = [];
  if (i1?.attack && near) {
    p2.hp = Math.max(0, p2.hp - 10);
    events.push("p1_hit");
  }
  if (i2?.attack && near) {
    p1.hp = Math.max(0, p1.hp - 10);
    events.push("p2_hit");
  }
  if (p1.hp <= 0) {
    p1.hp = 100;
    events.push("p1_ko");
  }
  if (p2.hp <= 0) {
    p2.hp = 100;
    events.push("p2_ko");
  }
  return events;
}

export function applyRules(prev: Snapshot, inputs: { p1?: InputIntent; p2?: InputIntent }): Snapshot {
  const p1 = stepOne(prev.p1, inputs.p1);
  const p2 = stepOne(prev.p2, inputs.p2);
  const events = resolveAttacks(p1, p2, inputs.p1, inputs.p2);
  const t = prev.t + 1;
  return { t, p1, p2, events, ts: Date.now() };
}

export function startRefereeLoop(matchId: string, seed?: Partial<Snapshot>) {
  let tick = seed?.t ?? 0;
  let snap: Snapshot = {
    t: seed?.t ?? 0,
    p1: seed?.p1 ?? { x: 300, y: GROUND_Y, vx: 0, vy: 0, hp: 100 },
    p2: seed?.p2 ?? { x: 660, y: GROUND_Y, vx: 0, vy: 0, hp: 100 },
    events: seed?.events,
    ts: Date.now(),
  } as Snapshot;
  const handle = setInterval(() => {
    const next = tick + 1;
    getInputsForTick(matchId, next)
      .then((inputs) => {
        snap = applyRules(snap, inputs);
        tick = snap.t;
        return writeSnapshot(matchId, tick, snap);
      })
      .catch((err) => {
        console.warn("[refereeLoop] tick failed", err);
      });
  }, 50);
  return () => clearInterval(handle);
}
