import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHostLoop } from '../hostLoop.js';
import { FIXED_STEP_MS, PLAYER_INITIAL_HP } from '../reducer.js';
import type { ActionDoc } from '../types.js';

const ARENA_ID = 'arena';
const ATTACKER_ID = 'p1';
const DEFENDER_ID = 'p2';

function makeAction(playerId: string, seq: number, input: ActionDoc['input']): ActionDoc {
  return {
    arenaId: ARENA_ID,
    playerId,
    seq,
    input,
    clientTs: seq * 16,
  };
}

test('host loop transitions from lobby to play and carries stocks forward', () => {
  const host = createHostLoop({
    myPlayerId: ATTACKER_ID,
    opponentId: DEFENDER_ID,
    startingStocks: 2,
    spawnOverrides: {
      [ATTACKER_ID]: { x: 360, y: 0 },
      [DEFENDER_ID]: { x: 392, y: 0 },
    },
  });

  const snapshot = host.step([], FIXED_STEP_MS);
  assert.equal(snapshot.phase, 'play');
  assert.equal(snapshot.players[ATTACKER_ID]?.stocks, 2);
  assert.equal(snapshot.players[DEFENDER_ID]?.stocks, 2);
});

test('host loop emits KO event and restores fighters after reset', () => {
  const host = createHostLoop({
    myPlayerId: ATTACKER_ID,
    opponentId: DEFENDER_ID,
    startingStocks: 2,
    koDurationMs: 400,
    resetDurationMs: 250,
    spawnOverrides: {
      [ATTACKER_ID]: { x: 360, y: 0 },
      [DEFENDER_ID]: { x: 392, y: 0 },
    },
  });

  let seq = 0;
  host.step([], FIXED_STEP_MS);

  const performAttack = () => {
    host.step([makeAction(ATTACKER_ID, (seq += 1), { attack: true })], FIXED_STEP_MS);
    host.step([makeAction(ATTACKER_ID, (seq += 1), { attack: false })], FIXED_STEP_MS);
    for (let i = 0; i < 20; i += 1) {
      host.step([], FIXED_STEP_MS);
    }
  };

  for (let i = 0; i < 10; i += 1) {
    performAttack();
  }

  let snapshot = host.step([], FIXED_STEP_MS);
  assert.equal(snapshot.phase, 'ko');
  const defenderHp = snapshot.players[DEFENDER_ID]?.hp ?? 0;
  assert.ok(defenderHp <= 0);
  assert.equal(snapshot.players[DEFENDER_ID]?.stocks, 1);
  assert.equal(snapshot.lastEvent?.type, 'ko');
  if (snapshot.lastEvent?.type === 'ko') {
    assert.equal(snapshot.lastEvent.loserId, DEFENDER_ID);
  }

  let guard = 0;
  while (snapshot.phase === 'ko' && guard < 200) {
    snapshot = host.step([], FIXED_STEP_MS);
    guard += 1;
  }
  assert.equal(snapshot.phase, 'reset');
  assert.equal(snapshot.players[DEFENDER_ID]?.hp, PLAYER_INITIAL_HP);

  while (snapshot.phase !== 'play' && guard < 400) {
    snapshot = host.step([], FIXED_STEP_MS);
    guard += 1;
  }

  assert.equal(snapshot.phase, 'play');
  assert.equal(snapshot.players[DEFENDER_ID]?.hp, PLAYER_INITIAL_HP);
  const pos = snapshot.players[DEFENDER_ID]?.pos;
  assert.deepEqual(pos, { x: 392, y: 0 });
});
