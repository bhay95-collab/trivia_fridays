import { test } from "node:test";
import assert from "node:assert/strict";
import { jokerPoints } from "../jokers.js";

test("an un-staked question scores exactly what it was graded", () => {
  assert.equal(jokerPoints(2, "correct", false), 2);
  assert.equal(jokerPoints(1, "partial", false), 1);
  assert.equal(jokerPoints(0, "wrong", false), 0);
});

test("a staked full-marks answer doubles", () => {
  assert.equal(jokerPoints(2, "correct", true), 4);
  assert.equal(jokerPoints(1.5, "correct", true), 3);
});

test("a staked partial or wrong answer scores zero (double or nothing)", () => {
  assert.equal(jokerPoints(1, "partial", true), 0);
  assert.equal(jokerPoints(2, "wrong", true), 0);
});

test("a staked blank answer (graded wrong, no points) scores zero", () => {
  assert.equal(jokerPoints(0, "wrong", true), 0);
});

test("non-numeric or missing base points never produce NaN", () => {
  assert.equal(jokerPoints(undefined, "correct", false), 0);
  assert.equal(jokerPoints(null, "correct", true), 0);
});
