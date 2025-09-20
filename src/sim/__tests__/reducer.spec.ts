import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyActions, getSnapshot, initSim } from '../reducer.js';
import type { ActionDoc } from '../types.js';

const STEP_MS = 16.6667;

function action(playerId: string, input: ActionDoc['input'], seq = 0): ActionDoc {
  return {
    arenaId: 'arena',
    playerId,
    seq,
    input,
    clientTs: 0,
  };
}

test('initSim spawns players with deterministic defaults', () => {
  const sim = initSim({ seed: 42, myPlayerId: 'p1', opponentId: 'p2' });
  const snap = getSnapshot(sim);
  assert.equal(snap.tick, 0);
  assert.equal(snap.tMs, 0);
  assert.deepEqual(snap.players['p1'].pos, { x: 200, y: 0 });
  assert.deepEqual(snap.players['p2'].pos, { x: 760, y: 0 });
  assert.equal(snap.players['p1'].hp, 100);
  assert.equal(snap.players['p2'].hp, 100);
});

test('holding right accelerates the player forward', () => {
  const sim = initSim({ seed: 1, myPlayerId: 'me', opponentId: 'op' });
  applyActions(sim, [action('me', { right: true })], 100);
  const snap = getSnapshot(sim);
  assert.ok(snap.players['me'].pos.x > 200);
  assert.equal(snap.players['me'].dir, 1);
});

test('jump is edge triggered and single use while airborne', () => {
  const sim = initSim({ seed: 1, myPlayerId: 'me', opponentId: 'op' });
  applyActions(sim, [action('me', { jump: true })], STEP_MS);
  let snap = getSnapshot(sim);
  const firstVy = snap.players['me'].vel.y;
  assert.ok(firstVy > 0);

  applyActions(sim, [action('me', { jump: false })], STEP_MS);
  snap = getSnapshot(sim);
  assert.ok(snap.players['me'].pos.y > 0);

  applyActions(sim, [action('me', { jump: true })], STEP_MS);
  snap = getSnapshot(sim);
  assert.ok(snap.players['me'].vel.y <= firstVy);
});

test('attack damages once per window within the arc', () => {
  const sim = initSim({ seed: 1, myPlayerId: 'a', opponentId: 'b' });
  const attacker = sim.snap.players['a'];
  const defender = sim.snap.players['b'];
  attacker.pos.x = 300;
  defender.pos.x = 330;
  attacker.dir = 1;
  defender.dir = -1;

  applyActions(sim, [action('a', { attack: true })], STEP_MS);
  let snap = getSnapshot(sim);
  assert.equal(snap.players['b'].hp, 90);

  applyActions(sim, [], STEP_MS);
  snap = getSnapshot(sim);
  assert.equal(snap.players['b'].hp, 90);
});

test("positions clamp to bounds and players ground at the floor", () => {
  const sim = initSim({ seed: 1, myPlayerId: "me", opponentId: "op" });
  const player = sim.snap.players["me"];
  player.pos.x = -75;
  player.vel.x = -200;

  applyActions(sim, [], STEP_MS);
  let snap = getSnapshot(sim);
  assert.equal(snap.players["me"].pos.x, 0);

  player.pos.y = 150;
  player.vel.y = -100;
  player.grounded = false;

  applyActions(sim, [], 500);
  snap = getSnapshot(sim);
  assert.equal(snap.players["me"].pos.y, 0);
  assert.equal(snap.players["me"].grounded, true);
});
