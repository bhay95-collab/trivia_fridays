import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the host-write RLS gaps are closed on all four tables', () => {
  const sql = read('sql/15_close_host_write_gaps.sql');

  for (const [policy, table] of [
    ['weeks_host', 'weeks'],
    ['q_host', 'questions'],
    ['ak_host', 'answer_keys'],
    ['qm_host', 'question_media'],
  ]) {
    assert.match(
      sql,
      new RegExp(`drop policy if exists ${policy}\\s+on ${table}`, 'i'),
      `${policy} on ${table} should be dropped`
    );
  }
});

test('no client code writes directly to the tables the RLS fix locks down', () => {
  const jsFiles = ['app.js', 'host.js', 'admin.js', 'play.js', 'poll.js', 'present.js'];
  const writeCall = /\.from\(["'](weeks|questions|answer_keys|question_media)["']\)[\s\S]{0,120}?\.(update|insert|delete|upsert)\(/;

  for (const file of jsFiles) {
    const src = read(file);
    assert.doesNotMatch(src, writeCall, `${file} should not write directly to a table the RLS fix locks down`);
  }
});
