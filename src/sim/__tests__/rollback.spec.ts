import { describe, expect, it } from 'vitest';

import { applyActions, getSnapshot, initSim, rewindTo } from '../reducer.js';
import type { ActionDoc, PlayerId } from '../types.js';

const STEP_MS = 16.6667;
const HISTORY_CAP = Math.ceil(3000 / STEP_MS);
const ARENA_ID = 'arena';

type SeqMap = Record<PlayerId, number>;

function nextAction(
  playerId: PlayerId,
  seqs: SeqMap,
  input: ActionDoc['input'],
): ActionDoc {
  const nextSeq = (seqs[playerId] ?? 0) + 1;
  seqs[playerId] = nextSeq;
  return {
    arenaId: ARENA_ID,
    playerId,
    seq: nextSeq,
    input,
    clientTs: 0,
  };
}

describe('sim rollback history', () => {
  it('rewinds within the buffer and diverges on new inputs', () => {
    const myId: PlayerId = 'p1';
    const oppId: PlayerId = 'p2';
    const sim = initSim({ seed: 123, myPlayerId: myId, opponentId: oppId });
    const seqs: SeqMap = { [myId]: 0, [oppId]: 0 };

    applyActions(sim, [nextAction(myId, seqs, { right: true })], 0);

    const ticksForward = 30;
    for (let i = 0; i < ticksForward; i += 1) {
      applyActions(sim, [], STEP_MS);
    }
    const snapshotAtT = getSnapshot(sim);
    const targetTick = snapshotAtT.tick;

    for (let i = 0; i < ticksForward; i += 1) {
      applyActions(sim, [], STEP_MS);
    }
    const originalAfter = getSnapshot(sim);

    rewindTo(sim, targetTick);
    const rewoundSnap = getSnapshot(sim);

    expect(rewoundSnap.tick).toBe(targetTick);
    const rewoundDiff = Math.abs(
      rewoundSnap.players[myId].pos.x - snapshotAtT.players[myId].pos.x,
    );
    expect(rewoundDiff).toBeLessThan(1e-3);

    applyActions(sim, [nextAction(myId, seqs, { jump: true })], 0);
    const ticksToResim = originalAfter.tick - targetTick;
    for (let i = 0; i < ticksToResim; i += 1) {
      applyActions(sim, [], STEP_MS);
      if (i === 0) {
        applyActions(sim, [nextAction(myId, seqs, { jump: false })], 0);
      }
    }

    const diverged = getSnapshot(sim);
    expect(diverged.players[myId].pos.y).toBeGreaterThan(originalAfter.players[myId].pos.y);
  });

  it('integrates a late attack action on rewind', () => {
    const myId: PlayerId = 'p1';
    const oppId: PlayerId = 'p2';
    const sim = initSim({ seed: 999, myPlayerId: myId, opponentId: oppId });
    const seqs: SeqMap = { [myId]: 0, [oppId]: 0 };

    applyActions(
      sim,
      [
        nextAction(myId, seqs, { right: true }),
        nextAction(oppId, seqs, { left: true }),
      ],
      0,
    );

    let attackTick: number | null = null;
    for (let i = 0; i < 180; i += 1) {
      applyActions(sim, [], STEP_MS);
      const snap = getSnapshot(sim);
      const dx = snap.players[oppId].pos.x - snap.players[myId].pos.x;
      if (attackTick === null && Math.abs(dx) <= 30) {
        attackTick = snap.tick;
        break;
      }
    }

    if (attackTick === null) {
      throw new Error('players never got close enough for attack test');
    }

    const rewindTick = attackTick - 1;
    const finalTick = attackTick + 20;
    while (getSnapshot(sim).tick < finalTick) {
      applyActions(sim, [], STEP_MS);
    }
    const beforeLate = getSnapshot(sim);
    expect(beforeLate.players[myId].hp).toBe(100);

    const lateAttack = nextAction(oppId, seqs, { attack: true });

    rewindTo(sim, rewindTick);
    applyActions(sim, [lateAttack], 0);

    const ticksToReplay = finalTick - rewindTick;
    for (let i = 0; i < ticksToReplay; i += 1) {
      applyActions(sim, [], STEP_MS);
      if (i === 0) {
        applyActions(sim, [nextAction(oppId, seqs, { attack: false })], 0);
      }
    }

    const afterLate = getSnapshot(sim);
    expect(afterLate.players[myId].hp).toBe(90);
    expect(sim._dbg?.lastAppliedSeq[oppId]).toBe(seqs[oppId]);
  });

  it('skips rewinds older than the history buffer', () => {
    const myId: PlayerId = 'p1';
    const oppId: PlayerId = 'p2';
    const sim = initSim({ seed: 7, myPlayerId: myId, opponentId: oppId });

    const totalTicks = HISTORY_CAP + 30;
    for (let i = 0; i < totalTicks; i += 1) {
      applyActions(sim, [], STEP_MS);
    }
    const before = getSnapshot(sim);

    rewindTo(sim, 0);
    const after = getSnapshot(sim);

    expect(after.tick).toBe(before.tick);
    expect(after.players[myId].pos.x).toBeCloseTo(before.players[myId].pos.x, 5);
    expect(sim._dbg?.lastRewindSkipped).toBe(true);
  });
});
