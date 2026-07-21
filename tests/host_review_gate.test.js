import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('scoring the room is a separate, gated step from closing it', () => {
  const sql = read('sql/16_host_review_gate.sql');

  // close_week() no longer writes week_scores itself.
  const closeWeek = sql.slice(
    sql.indexOf('create or replace function close_week'),
    sql.indexOf('create or replace function finalize_week_scores')
  );
  assert.doesNotMatch(closeWeek, /insert into week_scores/i,
    'close_week() should not write week_scores directly anymore');

  // finalize_week_scores() is the new gate: refuses while anything
  // free-text and not a straight "correct" is still unreviewed.
  const finalize = sql.slice(sql.indexOf('create or replace function finalize_week_scores'));
  assert.match(finalize, /still_pending/i);
  assert.match(finalize, /raise exception/i);
  assert.match(finalize, /insert into week_scores/i);
  assert.match(finalize, /scores_finalized = true/i);
});

test('multiple choice and exact free-text matches never need a review', () => {
  const sql = read('sql/16_host_review_gate.sql');
  const submitAnswer = sql.slice(
    sql.indexOf('create or replace function submit_answer'),
    sql.indexOf('create or replace function host_review_status')
  );

  assert.match(submitAnswer, /v_reviewed\s*:=\s*\(v_q_type\s*<>\s*'text'\s*or\s*v_verdict\s*=\s*'correct'\)/i);
});

test('choosing a verdict always counts as the review', () => {
  const sql = read('sql/16_host_review_gate.sql');
  const override = sql.slice(
    sql.indexOf('create or replace function override_response'),
    sql.indexOf('create or replace function close_week')
  );

  assert.match(override, /reviewed = true/i);
});

test('present.js gates the podium reveal on the review status and finalises scores before revealing', () => {
  const src = read('present.js');

  assert.match(src, /db\.rpc\(\s*["']host_review_status["']/);
  assert.match(src, /db\.rpc\(\s*["']finalize_week_scores["']/);

  const revealHandler = src.slice(src.indexOf(`$("reveal-podium-btn").addEventListener`));
  assert.match(revealHandler, /finalize_week_scores/);
  const finalizeIndex = revealHandler.indexOf('finalize_week_scores');
  const standingsIndex = revealHandler.indexOf('live_standings');
  assert.ok(finalizeIndex < standingsIndex, 'scores must be finalised before standings are read for the reveal');
});
