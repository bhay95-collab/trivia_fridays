import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rivalryLine,
  headToHead,
  RIVAL_BEHIND,
  RIVAL_TIE,
  RIVAL_TOP_RUNNERUP,
} from "../needle.js";

// The flavour tail rotates, so assert the fixed factual lead is right
// and the whole line is a valid lead + one of the pooled tails.
const oneOf = (line, lead, tails) =>
  tails.some((t) => line === `${lead} ${t}`);

const ranked = [
  { player_id: "a", display_name: "Ada", total_points: 54, weeks_played: 4 },
  { player_id: "b", display_name: "Bo", total_points: 44.5, weeks_played: 4 },
  { player_id: "c", display_name: "Cy", total_points: 44.5, weeks_played: 4 },
  { player_id: "d", display_name: "Di", total_points: 37.5, weeks_played: 4 },
];

test("a chasing player is needled about the person directly above", () => {
  const line = rivalryLine(ranked, "d");
  assert.ok(line.startsWith("7 behind Cy. "), line);
  assert.ok(oneOf(line, "7 behind Cy.", RIVAL_BEHIND), `unexpected tail: ${line}`);
});

test("a tie points at the shared rival", () => {
  const line = rivalryLine(ranked, "c");
  assert.ok(line.startsWith("Level with Bo. "), line);
  assert.ok(oneOf(line, "Level with Bo.", RIVAL_TIE), `unexpected tail: ${line}`);
});

test("the leader is told how far back the runner-up is", () => {
  const line = rivalryLine(ranked, "a");
  assert.ok(line.startsWith("Top of the board — Bo is 9.5 back. "), line);
  assert.ok(oneOf(line, "Top of the board — Bo is 9.5 back.", RIVAL_TOP_RUNNERUP), `unexpected tail: ${line}`);
});

test("decimal gaps are formatted to one place", () => {
  const line = rivalryLine(ranked, "b");
  assert.ok(line.startsWith("9.5 behind Ada. "), line);
  assert.ok(oneOf(line, "9.5 behind Ada.", RIVAL_BEHIND), `unexpected tail: ${line}`);
});

test("a player who hasn't played gets no line", () => {
  const withRookie = [...ranked, { player_id: "e", display_name: "Ez", total_points: 0, weeks_played: 0 }];
  assert.equal(rivalryLine(withRookie, "e"), "");
});

test("an unknown player id yields no line", () => {
  assert.equal(rivalryLine(ranked, "zzz"), "");
});

test("head-to-head reads from the viewer's side", () => {
  const me = ranked[3];   // Di, 37.5
  const them = ranked[0]; // Ada, 54
  assert.equal(headToHead(me, them), "You're 16.5 behind Ada.");
  assert.equal(headToHead(them, me), "You're 16.5 ahead of Di.");
});

test("head-to-head is empty on your own card", () => {
  assert.equal(headToHead(ranked[0], ranked[0]), "");
});

test("head-to-head reports a level score", () => {
  assert.equal(headToHead(ranked[1], ranked[2]), "You're level with Cy.");
});
