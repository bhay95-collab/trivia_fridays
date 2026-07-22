import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WAITING_FIRST,
  NO_QUIZ_LIVE,
  NO_SUBMISSION,
  NOBODY_ANSWERED,
  pickWaitingFirst,
  pickNoQuizLive,
  pickNoSubmission,
  pickNobodyAnswered,
} from '../quips.js';

const pools = {
  WAITING_FIRST,
  NO_QUIZ_LIVE,
  NO_SUBMISSION,
  NOBODY_ANSWERED,
};

test('every quip pool is a big set of unique lines so nothing goes stale', () => {
  for (const [name, pool] of Object.entries(pools)) {
    assert.ok(pool.length >= 12, `${name} has only ${pool.length} lines — want a big range`);
    assert.equal(new Set(pool).size, pool.length, `${name} has duplicate lines`);
    for (const line of pool) {
      assert.equal(typeof line, 'string');
      assert.ok(line.trim().length > 0, `${name} has an empty line`);
    }
  }
});

test('every picker only ever returns a line from its own pool', () => {
  const cases = [
    [pickWaitingFirst, WAITING_FIRST],
    [pickNoQuizLive, NO_QUIZ_LIVE],
    [pickNoSubmission, NO_SUBMISSION],
    [pickNobodyAnswered, NOBODY_ANSWERED],
  ];
  for (const [picker, pool] of cases) {
    for (let i = 0; i < 200; i++) {
      assert.ok(pool.includes(picker()), 'picker returned something off-list');
    }
  }
});

test('quips stay about the game, never about the person', () => {
  // same guard the Wooden Spoon roasts get: nothing that would land
  // badly on a Monday
  const banned = /\b(stupid|dumb|idiot|loser|ugly|fat|lazy)\b/i;
  for (const pool of Object.values(pools)) {
    for (const line of pool) assert.doesNotMatch(line, banned);
  }
});

test('the didn\'t-submit roast always points back at the leaderboard', () => {
  for (const line of NO_SUBMISSION) assert.match(line, /leaderboard/i);
});
