import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical live_state definitions include player media', () => {
  for (const path of ['sql/08_final_submission.sql', 'sql/10_no_more_night.sql', 'sql/13_readiness_hardening.sql']) {
    const sql = read(path);
    const liveState = sql.slice(sql.indexOf('create or replace function live_state'));

    assert.match(liveState, /media\s+jsonb/i, `${path} should return media`);
    assert.match(liveState, /from question_media m where m\.question_id = q\.id/i, `${path} should collect media rows`);
  }
});

test('active status is part of database identity helpers', () => {
  const schema = read('sql/01_schema.sql');
  const hardening = read('sql/13_readiness_hardening.sql');

  for (const sql of [schema, hardening]) {
    assert.match(sql, /where auth_id = auth\.uid\(\) and is_active/i);
    assert.match(sql, /where auth_id = auth\.uid\(\) and is_active\), false\)/i);
    assert.match(sql, /p\.auth_id = auth\.uid\(\) and p\.is_active/i);
  }
});

test('question media has RLS and URL-only constraints', () => {
  const schema = read('sql/01_schema.sql');
  const hardening = read('sql/13_readiness_hardening.sql');

  assert.match(schema, /source_type\s+text not null default 'url' check \(source_type = 'url'\)/i);
  assert.match(schema, /url\s+text not null check \(url ~\* '\^https:\/\/'\)/i);
  assert.match(schema, /alter table question_media\s+enable row level security/i);
  assert.match(schema, /create policy qm_read_visible on question_media/i);

  assert.match(hardening, /alter table question_media add constraint question_media_source_type_check check \(source_type = 'url'\)/i);
  assert.match(hardening, /alter table question_media add constraint question_media_url_check check \(url ~\* '\^https:\/\/'\) not valid/i);
});

test('privileged nav links start hidden on direct visits', () => {
  const expectations = [
    ['host.html', /id="nav-host" hidden/],
    ['present.html', /id="nav-present" hidden/],
    ['admin.html', /id="nav-admin" hidden/],
  ];

  for (const [path, pattern] of expectations) {
    assert.match(read(path), pattern);
  }
});
