'use strict';

// No platform APIs or timers live here. The host draws GO before calling go(),
// and schedules tick() using the deadlines returned in each snapshot.
const WAIT_MIN_MS = 2000;
const WAIT_MAX_MS = 6000;
const REACTION_TIMEOUT_MS = 5000;
const TIE_WINDOW_MS = 35;
const PLAYERS = ['p1', 'p2'];

function validTarget(value) {
  if (value !== 1 && value !== 3 && value !== 5) {
    throw new RangeError('targetScore must be 1, 3, or 5');
  }
  return value;
}

function emptyTimes() {
  return { p1: null, p2: null };
}

function otherPlayer(player) {
  return player === 'p1' ? 'p2' : 'p1';
}

function createDuel(options) {
  const config = options || {};
  let targetScore = validTarget(config.targetScore === undefined ? 3 : config.targetScore);
  const random = config.random === undefined ? Math.random : config.random;
  const now = config.now === undefined ? Date.now : config.now;
  if (typeof random !== 'function' || typeof now !== 'function') {
    throw new TypeError('random and now must be functions');
  }

  let phase = 'ready';
  let scores = { p1: 0, p2: 0 };
  let bestTimes = emptyTimes();
  let reactions = emptyTimes();
  let roundsPlayed = 0;
  let roundNumber = 1;
  let roundId = 0;
  let waitMs = null;
  let signalDueAt = null;
  let goAt = null;
  let reactionDeadlineAt = null;
  let settleAt = null;
  let firstPlayer = null;
  let result = null;
  let matchWinner = null;
  let lastTime = null;

  function readNow() {
    const value = now();
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('now must return a finite timestamp');
    }
    // A system-clock correction must never make reaction times negative or
    // reopen an expired arbitration window. Hosts may inject a monotonic clock.
    lastTime = lastTime === null ? value : Math.max(lastTime, value);
    return lastTime;
  }

  function snapshot() {
    return {
      phase,
      targetScore,
      scores: { p1: scores.p1, p2: scores.p2 },
      bestTimes: { p1: bestTimes.p1, p2: bestTimes.p2 },
      reactions: { p1: reactions.p1, p2: reactions.p2 },
      roundsPlayed,
      roundNumber,
      roundId,
      waitMs,
      signalDueAt,
      goAt,
      reactionDeadlineAt,
      settleAt,
      result: result && {
        reason: result.reason,
        winner: result.winner,
        loser: result.loser,
        reactionMs: result.reactionMs,
        reactions: { p1: result.reactions.p1, p2: result.reactions.p2 }
      },
      matchWinner
    };
  }

  function clearRound() {
    waitMs = null;
    signalDueAt = null;
    goAt = null;
    reactionDeadlineAt = null;
    settleAt = null;
    firstPlayer = null;
    reactions = emptyTimes();
    result = null;
  }

  function finish(reason, winner, loser) {
    if (winner) scores[winner] += 1;
    PLAYERS.forEach(function (player) {
      if (reactions[player] !== null &&
          (bestTimes[player] === null || reactions[player] < bestTimes[player])) {
        bestTimes[player] = reactions[player];
      }
    });
    roundsPlayed += 1;
    result = {
      reason,
      winner,
      loser,
      reactionMs: winner ? reactions[winner] : null,
      reactions: { p1: reactions.p1, p2: reactions.p2 }
    };
    matchWinner = winner && scores[winner] >= targetScore ? winner : null;
    phase = matchWinner ? 'complete' : 'result';
  }

  function hasRound(expectedRoundId) {
    return expectedRoundId === undefined || expectedRoundId === roundId;
  }

  function startRound() {
    if (phase !== 'ready' && phase !== 'result') return snapshot();
    const sample = random();
    if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('random must return a number from 0 (inclusive) to 1 (exclusive)');
    }
    const at = readNow();
    clearRound();
    roundId += 1;
    roundNumber = roundsPlayed + 1;
    waitMs = WAIT_MIN_MS + Math.floor(sample * (WAIT_MAX_MS - WAIT_MIN_MS));
    signalDueAt = at + waitMs;
    phase = 'waiting';
    return snapshot();
  }

  function go(expectedRoundId) {
    if (phase !== 'waiting' || !hasRound(expectedRoundId)) return snapshot();
    const at = readNow();
    if (at < signalDueAt) return snapshot();
    goAt = at;
    reactionDeadlineAt = at + REACTION_TIMEOUT_MS;
    phase = 'go';
    return snapshot();
  }

  function settleExpired(at) {
    if (phase === 'judging' && at >= settleAt) {
      finish('reaction', firstPlayer, otherPlayer(firstPlayer));
    } else if (phase === 'go' && at >= reactionDeadlineAt) {
      finish('timeout', null, null);
    }
  }

  function touch(player) {
    if (PLAYERS.indexOf(player) === -1 ||
        (phase !== 'waiting' && phase !== 'go' && phase !== 'judging')) {
      return snapshot();
    }
    const at = readNow();
    settleExpired(at);
    if (phase === 'waiting') {
      finish('false-start', otherPlayer(player), player);
    } else if (phase === 'go') {
      reactions[player] = Math.max(0, Math.round(at - goAt));
      firstPlayer = player;
      // The acceptance window is [first touch, settleAt). A touch at the exact
      // deadline cannot change an already due result, regardless of callback order.
      settleAt = Math.min(at + TIE_WINDOW_MS, reactionDeadlineAt);
      phase = 'judging';
    } else if (phase === 'judging' && player !== firstPlayer) {
      reactions[player] = Math.max(0, Math.round(at - goAt));
      finish('tie', null, null);
    }
    return snapshot();
  }

  function tick(expectedRoundId) {
    if (!hasRound(expectedRoundId) || (phase !== 'go' && phase !== 'judging')) {
      return snapshot();
    }
    settleExpired(readNow());
    return snapshot();
  }

  function cancelRound() {
    if (phase !== 'waiting' && phase !== 'go' && phase !== 'judging') return snapshot();
    clearRound();
    roundId += 1;
    roundNumber = roundsPlayed + 1;
    phase = 'ready';
    return snapshot();
  }

  function resetMatch(nextTargetScore) {
    const target = nextTargetScore === undefined ? targetScore : validTarget(nextTargetScore);
    clearRound();
    roundId += 1;
    targetScore = target;
    scores = { p1: 0, p2: 0 };
    bestTimes = emptyTimes();
    roundsPlayed = 0;
    roundNumber = 1;
    matchWinner = null;
    phase = 'ready';
    return snapshot();
  }

  return { snapshot, startRound, go, touch, tick, cancelRound, resetMatch };
}

module.exports = {
  createDuel,
  WAIT_MIN_MS,
  WAIT_MAX_MS,
  REACTION_TIMEOUT_MS,
  TIE_WINDOW_MS
};
