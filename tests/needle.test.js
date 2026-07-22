import { test } from "node:test";
import assert from "node:assert/strict";
import { rivalryLine } from "../needle.js";

const ranked = [
  { player_id: "a", display_name: "Ada", total_points: 54, weeks_played: 4 },
  { player_id: "b", display_name: "Bo", total_points: 44.5, weeks_played: 4 },
  { player_id: "c", display_name: "Cy", total_points: 44.5, weeks_played: 4 },
  { player_id: "d", display_name: "Di", total_points: 37.5, weeks_played: 4 },
];

test("a chasing player is needled about the person directly above", () => {
  assert.equal(rivalryLine(ranked, "d"), "7 behind Cy. One good week and it's yours.");
});

test("a tie points at the shared rival and the tie-break", () => {
  assert.equal(rivalryLine(ranked, "c"), "Level with Bo — the tie-break is the next right answer.");
});

test("the leader is told how far back the runner-up is", () => {
  assert.equal(rivalryLine(ranked, "a"), "Top of the board — Bo is 9.5 back. Mind the gap.");
});

test("decimal gaps are formatted to one place", () => {
  assert.equal(rivalryLine(ranked, "b"), "9.5 behind Ada. One good week and it's yours.");
});

test("a player who hasn't played gets no line", () => {
  const withRookie = [...ranked, { player_id: "e", display_name: "Ez", total_points: 0, weeks_played: 0 }];
  assert.equal(rivalryLine(withRookie, "e"), "");
});

test("an unknown player id yields no line", () => {
  assert.equal(rivalryLine(ranked, "zzz"), "");
});
