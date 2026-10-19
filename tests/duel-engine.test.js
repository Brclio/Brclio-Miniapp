'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDuel,
  WAIT_MIN_MS,
  WAIT_MAX_MS,
  REACTION_TIMEOUT_MS,
  TIE_WINDOW_MS
} = require('../minigame/lib/duel-engine');

function setup(targetScore) {
  let time = 10000;
  const duel = createDuel({ targetScore: targetScore || 3, random: () => 0, now: () => time });
  return {
    duel,
    at(value) { time = value; },
    advance(value) { time += value; },
    signal() {
      const waiting = duel.startRound();
      time = waiting.signalDueAt;
      return duel.go(waiting.roundId);
    },
    win(player, reactionMs) {
      this.signal();
      time += reactionMs;
      duel.touch(player);
      time += TIE_WINDOW_MS;
      return duel.tick();
    }
  };
}

test('starts ready with isolated snapshots and no score or best reaction', () => {
  const { duel } = setup();
  const state = duel.snapshot();
  assert.equal(state.phase, 'ready');
  assert.equal(state.roundNumber, 1);
  assert.equal(state.roundsPlayed, 0);
  assert.deepEqual(state.scores, { p1: 0, p2: 0 });
  assert.deepEqual(state.bestTimes, { p1: null, p2: null });
  state.scores.p1 = 999;
  state.bestTimes.p2 = 1;
  state.reactions.p1 = 100;
  assert.deepEqual(duel.snapshot().scores, { p1: 0, p2: 0 });
  assert.deepEqual(duel.snapshot().bestTimes, { p1: null, p2: null });
  assert.deepEqual(duel.snapshot().reactions, { p1: null, p2: null });
});

test('random waiting preserves source default range of 2 to just under 6 seconds', () => {
  for (const [sample, expected] of [[0, WAIT_MIN_MS], [0.5, 4000], [1 - Number.EPSILON, WAIT_MAX_MS - 1]]) {
    const duel = createDuel({ random: () => sample, now: () => 100 });
    const state = duel.startRound();
    assert.equal(state.waitMs, expected);
    assert.equal(state.signalDueAt, 100 + expected);
  }
});

test('deadline arrival alone never changes waiting to GO before the host has drawn it', () => {
  const h = setup();
  const waiting = h.duel.startRound();
  h.at(waiting.signalDueAt - 1);
  assert.equal(h.duel.go(waiting.roundId).phase, 'waiting');
  h.at(waiting.signalDueAt + 500);
  assert.equal(h.duel.tick(waiting.roundId).phase, 'waiting');
  const go = h.duel.go(waiting.roundId);
  assert.equal(go.phase, 'go');
  assert.equal(go.goAt, waiting.signalDueAt + 500);
  assert.equal(go.reactionDeadlineAt, go.goAt + REACTION_TIMEOUT_MS);
  h.advance(200);
  assert.equal(h.duel.touch('p1').reactions.p1, 200);
});

test('a touch after the nominal signal deadline still false-starts if GO was not drawn', () => {
  const h = setup();
  const waiting = h.duel.startRound();
  h.at(waiting.signalDueAt + 1000);
  const result = h.duel.touch('p2');
  assert.equal(result.result.reason, 'false-start');
  assert.equal(result.result.winner, 'p1');
  assert.equal(result.goAt, null);
});

for (const player of ['p1', 'p2']) {
  test(`${player} false-start awards opponent exactly one point without recording a reaction`, () => {
    const h = setup();
    h.duel.startRound();
    h.advance(100);
    const opponent = player === 'p1' ? 'p2' : 'p1';
    const state = h.duel.touch(player);
    assert.equal(state.result.reason, 'false-start');
    assert.equal(state.result.winner, opponent);
    assert.equal(state.result.loser, player);
    assert.equal(state.scores[opponent], 1);
    assert.equal(state.result.reactionMs, null);
    assert.deepEqual(state.bestTimes, { p1: null, p2: null });
    h.duel.touch(player);
    h.duel.touch(opponent);
    h.duel.go();
    h.advance(10000);
    assert.deepEqual(h.duel.tick().scores, state.scores);
    assert.equal(h.duel.snapshot().roundsPlayed, 1);
  });
}

test('first valid touch waits for arbitration and settles from its deadline', () => {
  const h = setup();
  const go = h.signal();
  h.advance(237);
  const first = h.duel.touch('p1');
  assert.equal(first.phase, 'judging');
  assert.equal(first.settleAt, go.goAt + 237 + TIE_WINDOW_MS);
  assert.deepEqual(first.scores, { p1: 0, p2: 0 });
  h.at(first.settleAt - 1);
  assert.equal(h.duel.tick().phase, 'judging');
  h.at(first.settleAt);
  const settled = h.duel.tick();
  assert.equal(settled.phase, 'result');
  assert.equal(settled.result.winner, 'p1');
  assert.equal(settled.result.reactionMs, 237);
  assert.equal(settled.bestTimes.p1, 237);
  assert.equal(settled.scores.p1, 1);
});

for (const player of ['p1', 'p2']) {
  test(`near-simultaneous touches tie in either player order (${player} first)`, () => {
    const h = setup();
    h.signal();
    h.advance(180);
    h.duel.touch(player);
    h.advance(TIE_WINDOW_MS - 1);
    const opponent = player === 'p1' ? 'p2' : 'p1';
    const state = h.duel.touch(opponent);
    assert.equal(state.phase, 'result');
    assert.equal(state.result.reason, 'tie');
    assert.equal(state.result.winner, null);
    assert.deepEqual(state.scores, { p1: 0, p2: 0 });
    assert.equal(state.bestTimes[player], 180);
    assert.equal(state.bestTimes[opponent], 214);
    assert.equal(state.roundsPlayed, 1);
  });
}

test('second touch at the exact arbitration deadline cannot alter the winner', () => {
  for (const tickFirst of [true, false]) {
    const h = setup();
    h.signal();
    h.advance(200);
    const judging = h.duel.touch('p2');
    h.at(judging.settleAt);
    if (tickFirst) h.duel.tick();
    const state = h.duel.touch('p1');
    assert.equal(state.result.reason, 'reaction');
    assert.equal(state.result.winner, 'p2');
    assert.equal(state.reactions.p1, null);
    assert.deepEqual(state.scores, { p1: 0, p2: 1 });
  }
});

test('repeated touches from one player cannot tie or extend the settlement window', () => {
  const h = setup();
  h.signal();
  h.advance(250);
  const first = h.duel.touch('p1');
  h.advance(20);
  const repeated = h.duel.touch('p1');
  assert.equal(repeated.settleAt, first.settleAt);
  assert.equal(repeated.reactions.p1, 250);
  h.advance(10000);
  assert.equal(h.duel.tick().result.winner, 'p1');
});

test('no input times out as a draw, including when a delayed touch arrives before the timer callback', () => {
  for (const useTouch of [false, true]) {
    const h = setup();
    const go = h.signal();
    h.at(go.reactionDeadlineAt - 1);
    assert.equal(h.duel.tick().phase, 'go');
    h.at(go.reactionDeadlineAt);
    const state = useTouch ? h.duel.touch('p1') : h.duel.tick();
    assert.equal(state.result.reason, 'timeout');
    assert.equal(state.result.winner, null);
    assert.deepEqual(state.scores, { p1: 0, p2: 0 });
    assert.deepEqual(state.bestTimes, { p1: null, p2: null });
  }
});

test('reaction near global timeout wins; arbitration never accepts a touch past that deadline', () => {
  const h = setup();
  const go = h.signal();
  h.at(go.reactionDeadlineAt - 10);
  const judging = h.duel.touch('p1');
  assert.equal(judging.settleAt, go.reactionDeadlineAt);
  h.at(go.reactionDeadlineAt);
  const state = h.duel.touch('p2');
  assert.equal(state.result.reason, 'reaction');
  assert.equal(state.result.winner, 'p1');
  assert.equal(state.result.reactionMs, 4990);
  assert.equal(state.reactions.p2, null);
});

test('scores and best reactions persist across rounds and slower rounds do not overwrite records', () => {
  const h = setup(5);
  let state = h.win('p1', 200);
  assert.equal(state.roundNumber, 1);
  state = h.win('p2', 300);
  assert.equal(state.roundNumber, 2);
  state = h.win('p1', 240);
  assert.deepEqual(state.bestTimes, { p1: 200, p2: 300 });
  state = h.win('p1', 180);
  assert.equal(state.roundNumber, 4);
  assert.equal(state.roundsPlayed, 4);
  assert.deepEqual(state.scores, { p1: 3, p2: 1 });
  assert.deepEqual(state.bestTimes, { p1: 180, p2: 300 });
  const view = h.duel.snapshot();
  view.result.reactions.p1 = 999;
  view.result.reason = 'timeout';
  assert.equal(h.duel.snapshot().result.reactions.p1, 180);
  assert.equal(h.duel.snapshot().result.reason, 'reaction');
});

for (const target of [1, 3, 5]) {
  test(`first-to-${target} finishes exactly at target and requires a reset for another match`, () => {
    const h = setup(target);
    for (let count = 1; count <= target; count += 1) {
      const state = h.win('p2', 150 + count);
      assert.equal(state.scores.p2, count);
      assert.equal(state.phase, count === target ? 'complete' : 'result');
    }
    const completed = h.duel.snapshot();
    assert.equal(completed.matchWinner, 'p2');
    assert.deepEqual(h.duel.startRound(), completed);
    assert.deepEqual(h.duel.cancelRound(), completed);
    const reset = h.duel.resetMatch(3);
    assert.equal(reset.targetScore, 3);
    assert.equal(reset.phase, 'ready');
    assert.equal(reset.matchWinner, null);
    assert.equal(reset.roundNumber, 1);
    assert.equal(reset.roundsPlayed, 0);
    assert.deepEqual(reset.scores, { p1: 0, p2: 0 });
    assert.deepEqual(reset.bestTimes, { p1: null, p2: null });
    assert.equal(h.duel.startRound().phase, 'waiting');
  });
}

test('background cancellation in every active phase preserves prior scores and records without loss', () => {
  for (const phase of ['waiting', 'go', 'judging']) {
    const h = setup();
    h.win('p2', 300);
    const waiting = h.duel.startRound();
    if (phase !== 'waiting') {
      h.at(waiting.signalDueAt);
      h.duel.go();
    }
    if (phase === 'judging') {
      h.advance(100);
      h.duel.touch('p1');
    }
    assert.equal(h.duel.snapshot().phase, phase);
    const cancelled = h.duel.cancelRound();
    assert.equal(cancelled.phase, 'ready');
    assert.equal(cancelled.result, null);
    assert.equal(cancelled.roundNumber, 2);
    assert.equal(cancelled.roundsPlayed, 1);
    assert.deepEqual(cancelled.scores, { p1: 0, p2: 1 });
    assert.deepEqual(cancelled.bestTimes, { p1: null, p2: 300 });
    assert.deepEqual(cancelled.reactions, { p1: null, p2: null });
    h.advance(100000);
    assert.equal(h.duel.tick().phase, 'ready');
    assert.equal(h.duel.startRound().roundNumber, 2);
  }
});

test('stale signal and timeout callbacks cannot act on a later round', () => {
  const h = setup();
  const oldRound = h.duel.startRound();
  h.duel.cancelRound();
  const current = h.duel.startRound();
  h.at(current.signalDueAt);
  assert.equal(h.duel.go(oldRound.roundId).phase, 'waiting');
  assert.equal(h.duel.go(current.roundId).phase, 'go');
  h.advance(200);
  const judging = h.duel.touch('p1');
  h.at(judging.settleAt + 1000);
  assert.equal(h.duel.tick(oldRound.roundId).phase, 'judging');
  assert.equal(h.duel.tick(current.roundId).result.winner, 'p1');
});

test('duplicate start and signal actions cannot replace a round or reset the reaction clock', () => {
  const h = setup();
  const waiting = h.duel.startRound();
  h.advance(100);
  assert.deepEqual(h.duel.startRound(), waiting);
  h.at(waiting.signalDueAt);
  const go = h.duel.go();
  h.advance(200);
  assert.deepEqual(h.duel.go(), go);
  assert.equal(h.duel.touch('p1').reactions.p1, 200);
});

test('unknown players and touches outside a round cannot alter state', () => {
  const h = setup();
  const ready = h.duel.snapshot();
  assert.deepEqual(h.duel.touch('p1'), ready);
  const go = h.signal();
  assert.deepEqual(h.duel.touch('p3'), go);
  assert.deepEqual(h.duel.touch(null), go);
});

test('backward wall-clock movement cannot create negative reaction times', () => {
  const h = setup();
  const go = h.signal();
  h.at(go.goAt - 1000);
  const judging = h.duel.touch('p1');
  assert.equal(judging.reactions.p1, 0);
  assert.equal(judging.settleAt, go.goAt + TIE_WINDOW_MS);
  h.at(judging.settleAt);
  assert.equal(h.duel.tick().bestTimes.p1, 0);
});

test('configuration rejects unsupported rules and invalid injected clocks or random values', () => {
  for (const targetScore of [0, 2, 4, 6, '3', null]) {
    assert.throws(() => createDuel({ targetScore }), RangeError);
  }
  assert.throws(() => createDuel({ random: 1 }), TypeError);
  assert.throws(() => createDuel({ now: 100 }), TypeError);
  for (const sample of [-0.1, 1, NaN, Infinity, '0']) {
    const duel = createDuel({ random: () => sample });
    assert.throws(() => duel.startRound(), RangeError);
    assert.equal(duel.snapshot().phase, 'ready');
    assert.equal(duel.snapshot().roundId, 0);
  }
  const clockless = createDuel({ random: () => 0, now: () => NaN });
  assert.throws(() => clockless.startRound(), TypeError);
  const h = setup();
  h.win('p1', 180);
  const prior = h.duel.snapshot();
  assert.throws(() => h.duel.resetMatch(2), RangeError);
  assert.deepEqual(h.duel.snapshot(), prior);
});
