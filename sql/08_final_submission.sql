-- ============================================================
-- TRIVIA FRIDAYS - CHANGEABLE ANSWERS + FINAL SUBMISSION
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: the table is "create table if not exists", and
-- every function is "create or replace" with the same signature it
-- already had (or is brand new).
--
-- This replaces the old model from sql/07_live_functions.sql, where
-- the host opened and locked one question at a time and locking
-- immediately revealed the answer. Real nights have a final
-- read-through where people go back and change their minds, so:
--
--   * A question, once opened, stays open and editable by every
--     player for the rest of the night - no more per-question lock.
--   * Nothing is revealed to a player, and no score counts toward
--     the standings, until THAT player submits their final answers.
--     Submitting is final for them; everyone else keeps playing.
--   * When the host ends the night, anyone who answered something
--     but never got around to clicking Submit is swept in
--     automatically - the night's over, so there's no more risk in
--     it, and nobody should lose points to a forgotten click.
-- ============================================================

-- ============================================================
-- SUBMISSIONS
-- One row per player per week: "I'm done, grade me." Only ever
-- written by submit_final_answers() or close_week()'s sweep -
-- there is deliberately no insert policy here, so a direct table
-- write can't be used to dodge the host-doesn't-play check the way
-- an open insert policy would allow.
-- ============================================================
create table if not exists week_submissions (
  week_id      uuid not null references weeks(id) on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key (week_id, player_id)
);

alter table week_submissions enable row level security;

drop policy if exists sub_read on week_submissions;
create policy sub_read on week_submissions for select using (player_id = me() or is_host_of(week_id));

-- ============================================================
-- ANSWERING
-- Now an upsert: answering the same question again just changes
-- what's on file, right up until this player submits. Still refuses
-- while the question isn't open, and still refuses the host.
-- ============================================================
create or replace function submit_answer(p_question_id uuid, p_answer text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me      uuid := me();
  v_week    uuid;
  v_host    uuid;
  v_status  text;
  v_verdict text;
  v_points  numeric;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  select q.week_id, q.status into v_week, v_status from questions q where q.id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;
  if v_status <> 'open' then raise exception 'That question is not open.'; end if;

  select w.host_id into v_host from weeks w where w.id = v_week;
  if v_host = v_me then
    raise exception 'The host does not play.';
  end if;

  if exists (select 1 from week_submissions s where s.week_id = v_week and s.player_id = v_me) then
    raise exception 'You already submitted your final answers.';
  end if;

  select verdict, points into v_verdict, v_points from grade_response(p_question_id, p_answer);

  insert into responses (question_id, player_id, answer_raw, verdict, points_awarded)
  values (p_question_id, v_me, p_answer, v_verdict, v_points)
  on conflict (question_id, player_id) do update
  set answer_raw     = excluded.answer_raw,
      verdict        = excluded.verdict,
      points_awarded = excluded.points_awarded,
      overridden     = false; -- a changed answer supersedes any earlier host override

  return 'saved';
end;
$$;

-- Locks in everything this player has answered so far. Final -
-- submit_answer() will refuse them from here on, and this is what
-- unlocks their own reveal and lets their points count in standings.
create or replace function submit_final_answers(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := me();
  v_status text;
  v_host   uuid;
begin
  if v_me is null then raise exception 'Sign in to play.'; end if;

  select w.status, w.host_id into v_status, v_host from weeks w where w.id = p_week_id;
  if not found then raise exception 'That quiz night was not found.'; end if;
  if v_status <> 'live' then raise exception 'This night is not live.'; end if;

  if v_host = v_me then
    raise exception 'The host does not play.';
  end if;

  insert into week_submissions (week_id, player_id) values (p_week_id, v_me)
  on conflict (week_id, player_id) do nothing;
end;
$$;

-- For when someone submits by mistake and needs back in. Deletes
-- their submission so submit_answer() will accept changes again.
-- Only while the night is still live - once it's closed, every
-- question is locked, so there'd be nothing left for them to
-- actually answer and this would just strand them without a result.
create or replace function host_reopen_submission(p_week_id uuid, p_player_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host can do that.';
  end if;

  select status into v_status from weeks where id = p_week_id;
  if v_status <> 'live' then
    raise exception 'This night is not live.';
  end if;

  delete from week_submissions where week_id = p_week_id and player_id = p_player_id;
end;
$$;

-- ============================================================
-- THE PLAYER'S PHONE
-- Always at least one row. Before this player has submitted: one
-- row per open question, their own answer if they've given one, and
-- no answer key or verdict - those stay null until they submit.
-- Once they've submitted: the same rows, now with the answer key
-- and their verdict filled in. A question that hasn't been opened
-- yet never appears, submitted or not.
--
-- Dropped first: this reshapes the columns returned by the
-- sql/07_live_functions.sql version, and create or replace cannot
-- change a function's OUT parameters, only add or drop the whole
-- function.
-- ============================================================
drop function if exists live_state(uuid);

create or replace function live_state(p_week_id uuid)
returns table(
  week_status      text,
  total_questions  int,
  submitted        boolean,
  question_id      uuid,
  q_number         int,
  q_type           text,
  prompt           text,
  options          jsonb,
  points           numeric,
  my_answer        text,
  correct_key      text,
  correct_text     text,
  my_verdict       text,
  my_points        numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me          uuid := me();
  v_week_status text;
  v_total       int;
  v_submitted   boolean;
  v_open_count  int;
begin
  if v_me is null then
    raise exception 'Sign in to play.';
  end if;

  select w.status into v_week_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz night was not found.';
  end if;

  select count(*) into v_total from questions qq where qq.week_id = p_week_id;
  v_submitted := exists (select 1 from week_submissions s where s.week_id = p_week_id and s.player_id = v_me);

  if v_submitted then
    return query
      select v_week_status, v_total, true, q.id, q.q_number, q.q_type, q.prompt, q.options, q.points,
             r.answer_raw, k.correct_key, k.correct_text, r.verdict, r.points_awarded
      from questions q
      left join responses r on r.question_id = q.id and r.player_id = v_me
      left join answer_keys k on k.question_id = q.id
      where q.week_id = p_week_id and q.status in ('open', 'locked')
      order by q.q_number;
    return;
  end if;

  select count(*) into v_open_count from questions qq where qq.week_id = p_week_id and qq.status = 'open';

  if v_open_count = 0 then
    return query select v_week_status, v_total, false, null::uuid, null::int, null::text, null::text, null::jsonb,
                        null::numeric, null::text, null::text, null::text, null::text, null::numeric;
    return;
  end if;

  return query
    select v_week_status, v_total, false, q.id, q.q_number, q.q_type, q.prompt, q.options, q.points,
           r.answer_raw, null::text, null::text, null::text, null::numeric
    from questions q
    left join responses r on r.question_id = q.id and r.player_id = v_me
    where q.week_id = p_week_id and q.status = 'open'
    order by q.q_number;
end;
$$;

-- ============================================================
-- THE HOST'S SCREEN
-- Question content still comes from host_quiz(). This is just
-- what's happening right now: how far through the quiz the room is,
-- and how many players have submitted.
--
-- Dropped first: this reshapes the columns returned by the
-- sql/07_live_functions.sql version, and create or replace cannot
-- change a function's OUT parameters, only add or drop the whole
-- function.
-- ============================================================
drop function if exists host_live_state(uuid);

create or replace function host_live_state(p_week_id uuid)
returns table(
  week_status      text,
  total_questions  int,
  open_questions   int,
  expected_count   int,
  submitted_count  int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_week_status text;
  v_total       int;
  v_open        int;
  v_expected    int;
  v_submitted   int;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host can see this.';
  end if;

  select w.status into v_week_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz night was not found.';
  end if;

  select count(*) into v_total from questions qq where qq.week_id = p_week_id;
  select count(*) into v_open from questions qq where qq.week_id = p_week_id and qq.status = 'open';

  select count(*) into v_expected
  from players p
  where p.is_active and p.id <> (select w2.host_id from weeks w2 where w2.id = p_week_id);

  select count(*) into v_submitted from week_submissions s where s.week_id = p_week_id;

  return query select v_week_status, v_total, v_open, v_expected, v_submitted;
end;
$$;

-- Who has submitted, for the host's screen - a name list is fine
-- here, it's the host's own view, not broadcast to the room.
create or replace function host_submissions(p_week_id uuid)
returns table(player_id uuid, display_name text, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, s.submitted_at
  from week_submissions s
  join players p on p.id = s.player_id
  where s.week_id = p_week_id and is_host_of(p_week_id)
  order by s.submitted_at
$$;

-- ============================================================
-- STANDINGS
-- Only counts a player's points once THEY have submitted - a score
-- appearing before that would tell the room how they're doing on
-- questions still open for everyone else. The host doesn't play.
-- ============================================================
create or replace function live_standings(p_week_id uuid)
returns table(player_id uuid, display_name text, total_points numeric, standing int)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.display_name,
    coalesce(sum(r.points_awarded), 0) as total_points,
    rank() over (order by coalesce(sum(r.points_awarded), 0) desc)::int as standing
  from players p
  left join responses r
    on r.player_id = p.id
   and r.player_id in (select s.player_id from week_submissions s where s.week_id = p_week_id)
  where p.is_active and p.id <> (select w.host_id from weeks w where w.id = p_week_id)
  group by p.id, p.display_name
  order by total_points desc, p.display_name
$$;

-- ============================================================
-- REVIEWING AFTER THE NIGHT
-- The shared Present screen never shows a correct answer or another
-- player's response while the night is live - that screen is on the
-- room's Teams call, and nothing is safe to reveal there until every
-- player has personally submitted. So the answer review and the
-- override panel only make sense, and only get shown, once the
-- night is closed. But close_week() already took a snapshot into
-- week_scores by then - overriding a verdict after that would go
-- stale on the leaderboard unless something refreshes it. So
-- override_response() now re-syncs that one player's week_scores
-- row whenever the week is already closed when the override happens.
-- ============================================================
create or replace function override_response(p_response_id uuid, p_verdict text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week      uuid;
  v_week_status text;
  v_pts       numeric(5,2);
  v_player    uuid;
begin
  select q.week_id, q.points, r.player_id into v_week, v_pts, v_player
  from responses r join questions q on q.id = r.question_id
  where r.id = p_response_id;

  if v_week is null then raise exception 'Response not found.'; end if;
  if not is_host_of(v_week) then raise exception 'Only the host can change scores.'; end if;

  update responses
  set verdict = p_verdict,
      overridden = true,
      points_awarded = case p_verdict
                         when 'correct' then v_pts
                         when 'partial' then round(v_pts / 2, 2)
                         else 0 end
  where id = p_response_id;

  select status into v_week_status from weeks where id = v_week;
  if v_week_status = 'closed' then
    insert into week_scores (week_id, player_id, points, attended)
    select v_week, r.player_id, sum(r.points_awarded), true
    from responses r
    join questions q on q.id = r.question_id
    where q.week_id = v_week and r.player_id = v_player
    group by r.player_id
    on conflict (week_id, player_id) do update set points = excluded.points;
  end if;
end;
$$;

-- ============================================================
-- FINISHING THE NIGHT
-- Same signature as before. No longer refuses on an open question -
-- once opened, questions stay open for the rest of the night, so
-- that check no longer means anything. Instead it sweeps in anyone
-- who answered something but never clicked Submit, since the night
-- ending removes any reason to keep holding their score back.
-- ============================================================
create or replace function close_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_host_of(p_week_id) then raise exception 'Only the host can close the week.'; end if;

  select status into v_status from weeks where id = p_week_id;
  if not found then raise exception 'That quiz night was not found.'; end if;
  if v_status <> 'live' then raise exception 'This night is not live.'; end if;

  insert into week_submissions (week_id, player_id)
  select distinct p_week_id, r.player_id
  from responses r
  join questions q on q.id = r.question_id
  where q.week_id = p_week_id
  on conflict (week_id, player_id) do nothing;

  delete from week_scores where week_id = p_week_id;

  insert into week_scores (week_id, player_id, points, attended)
  select p_week_id, r.player_id, sum(r.points_awarded), true
  from responses r
  join questions q on q.id = r.question_id
  where q.week_id = p_week_id
  group by r.player_id;

  update questions set status = 'locked' where week_id = p_week_id;
  update weeks set status = 'closed' where id = p_week_id;
end;
$$;
