import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STREAK_MIN,
  streakSegments,
  bestStreak,
  streakLine,
  streakBreakLine,
  ROASTS,
  randomRoast,
} from '../streaks.js';

test('splits verdicts into runs of correct and everything else', () => {
  // Arrange
  const verdicts = ['correct', 'correct', 'correct', 'wrong', 'partial', 'correct'];

  // Act
  const segments = streakSegments(verdicts);

  // Assert
  assert.deepEqual(segments, [
    { start: 0, length: 3, type: 'correct' },
    { start: 3, length: 2, type: 'other' },
    { start: 5, length: 1, type: 'correct' },
  ]);
});

test('returns no segments for an empty night', () => {
  assert.deepEqual(streakSegments([]), []);
  assert.equal(bestStreak([]), 0);
});

test('treats partial answers as streak breakers', () => {
  const verdicts = ['correct', 'correct', 'partial', 'correct'];
  assert.equal(bestStreak(verdicts), 2);
});

test('finds the longest streak across the whole night', () => {
  const verdicts = ['correct', 'wrong', 'correct', 'correct', 'correct', 'correct', 'wrong', 'correct'];
  assert.equal(bestStreak(verdicts), 4);
});

test('says nothing about runs shorter than the minimum', () => {
  assert.equal(streakLine(STREAK_MIN - 1), '');
  assert.equal(streakBreakLine(STREAK_MIN - 1, 5), '');
});

test('has something to say at every streak length from three up', () => {
  for (let len = STREAK_MIN; len <= 10; len++) {
    assert.ok(streakLine(len).length > 0, `no line for a streak of ${len}`);
  }
});

test('mentions the question that broke the streak', () => {
  const line = streakBreakLine(4, 7);
  assert.match(line, /Q7/);
});

test('offers a big set of roasts so the plaque keeps changing', () => {
  assert.ok(ROASTS.length >= 20, `only ${ROASTS.length} roasts - want a big range`);
  assert.equal(new Set(ROASTS).size, ROASTS.length, 'roasts should be unique');
});

test('randomRoast always returns one of the roasts', () => {
  for (let i = 0; i < 200; i++) {
    assert.ok(ROASTS.includes(randomRoast()), 'randomRoast returned something off-list');
  }
});

test('spoon roasts stay about trivia, not the person', () => {
  // no roast should reference anything but quiz performance - the whole
  // set is checked for vocabulary that would land badly on a Monday
  const banned = /\b(stupid|dumb|idiot|loser|ugly|fat|lazy)\b/i;
  for (const roast of ROASTS) {
    assert.doesNotMatch(roast, banned);
  }
});
