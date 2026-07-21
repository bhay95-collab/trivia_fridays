-- ============================================================
-- TRIVIA FRIDAYS - LIVE QUIZ NIGHT
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: everything is "create or replace", the publication
-- change is guarded, and close_week() is redefined with the same
-- signature it already had.
-- ============================================================

-- ============================================================
-- REALTIME
-- Players' phones subscribe to changes on `questions` for the live
-- week, filtered by RLS same as everywhere else - a question only
-- becomes visible over the socket the moment it satisfies
-- q_read_open (status open/locked, or you're the host). Nothing
-- else is replicated: no answer_keys, no responses. Guarded so
-- re-running this file doesn't error on an already-added table.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'questions'
  ) then
    alter publication supabase_realtime add table questions;
  end if;
end $$;

-- ============================================================
-- STARTING THE NIGHT
-- ============================================================
create or replace function start_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_count   int;
  v_missing int;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host can start the night.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz night was not found.';
  end if;
  if v_status <> 'building' then
    raise exception 'This night is not ready to start.';
  end if;

  select count(*) into v_count from questions qq where qq.week_id = p_week_id;
  if v_count = 0 then
    raise exception 'Add at least one question before starting the night.';
  end if;

  select count(*) into v_missing
  from questions qq
  where qq.week_id = p_week_id
    and not exists (select 1 from answer_keys k where k.question_id = qq.id);
  if v_missing > 0 then
    raise exception 'Every question needs an answer key before you can start.';
  end if;

  update weeks set status = 'live' where id = p_week_id;
end;
$$;

-- ============================================================
-- THE PLAYER'S PHONE
-- One row, always. When nothing is open or locked, everything
-- past total_questions is null - that's the waiting state. The
-- correct answer and this player's verdict only ever appear once
-- the question is locked; while it's open they're both null.
-- ============================================================
create or replace function live_state(p_week_id uuid)
returns table(
  week_status       text,
  question_id       uuid,
  q_number          int,
  total_questions   int,
  q_type            text,
  prompt            text,
  options           jsonb,
  points            numeric,
  q_status          text,
  already_answered  boolean,
  correct_key       text,
  correct_text      text,
  my_verdict        text,
  my_points         numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me          uuid := me();
  v_week_status text;
  v_total       int;
  q             questions%rowtype;
  k             answer_keys%rowtype;
  v_answered    boolean;
  v_verdict     text;
  v_points      numeric;
begin
  if v_me is null then
    raise exception 'Sign in to play.';
  end if;

  select w.status into v_week_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz night was not found.';
  end if;

  select count(*) into v_total from questions qq where qq.week_id = p_week_id;

  select * into q
  from questions qq
  where qq.week_id = p_week_id and qq.status in ('open', 'locked')
  order by qq.opened_at desc nulls last
  limit 1;

  if not found then
    return query select v_week_status, null::uuid, null::int, v_total, null::text, null::text, null::jsonb,
                        null::numeric, null::text, null::boolean, null::text, null::text, null::text, null::numeric;
    return;
  end if;

  v_answered := exists (select 1 from responses r where r.question_id = q.id and r.player_id = v_me);

  if q.status = 'locked' then
    select * into k from answer_keys where answer_keys.question_id = q.id;
    select r.verdict, r.points_awarded into v_verdict, v_points
      from responses r where r.question_id = q.id and r.player_id = v_me;

    return query select v_week_status, q.id, q.q_number, v_total, q.q_type, q.prompt, q.options, q.points, q.status,
                        v_answered, k.correct_key, k.correct_text, v_verdict, v_points;
  else
    return query select v_week_status, q.id, q.q_number, v_total, q.q_type, q.prompt, q.options, q.points, q.status,
                        v_answered, null::text, null::text, null::text, null::numeric;
  end if;
end;
$$;

-- No playing for the host - keeps the room's standings honest.
-- Deliberately checks weeks.host_id directly, not is_host_of():
-- is_host_of() is also true for any admin, and an admin who isn't
-- hosting this particular night should still get to play.
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

  select verdict, points into v_verdict, v_points from grade_response(p_question_id, p_answer);

  insert into responses (question_id, player_id, answer_raw, verdict, points_awarded)
  values (p_question_id, v_me, p_answer, v_verdict, v_points);

  return 'submitted';   -- deliberately tells the player nothing about the result
exception
  when unique_violation then
    raise exception 'You already answered that one.';
end;
$$;

-- ============================================================
-- THE HOST'S SCREEN
-- Content (prompt, options, answer key) comes from host_quiz().
-- This is just what's happening right now: the current question,
-- and how many of the room have answered it.
-- ============================================================
create or replace function host_live_state(p_week_id uuid)
returns table(
  week_status      text,
  question_id      uuid,
  q_number         int,
  total_questions  int,
  q_type           text,
  prompt           text,
  options          jsonb,
  points           numeric,
  q_status         text,
  answered_count   int,
  expected_count   int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_week_status text;
  v_total       int;
  v_expected    int;
  q             questions%rowtype;
  v_answered    int;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host can see this.';
  end if;

  select w.status into v_week_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz night was not found.';
  end if;

  select count(*) into v_total from questions qq where qq.week_id = p_week_id;

  select count(*) into v_expected
  from players p
  where p.is_active and p.id <> (select w2.host_id from weeks w2 where w2.id = p_week_id);

  select * into q
  from questions qq
  where qq.week_id = p_week_id and qq.status in ('open', 'locked')
  order by qq.opened_at desc nulls last
  limit 1;

  if not found then
    return query select v_week_status, null::uuid, null::int, v_total, null::text, null::text, null::jsonb,
                        null::numeric, null::text, null::int, v_expected;
    return;
  end if;

  select count(*) into v_answered from responses r where r.question_id = q.id;

  return query select v_week_status, q.id, q.q_number, v_total, q.q_type, q.prompt, q.options, q.points, q.status,
                      v_answered, v_expected;
end;
$$;

-- ============================================================
-- STANDINGS
-- Only ever sums points from LOCKED questions. A question that is
-- still open contributes nothing here, even though submit_answer()
-- has already graded and stored it - otherwise a score climbing
-- mid-question would tell the room who got it right before the
-- reveal. The host doesn't play, so isn't ranked.
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
   and r.question_id in (select qq.id from questions qq where qq.week_id = p_week_id and qq.status = 'locked')
  where p.is_active and p.id <> (select w.host_id from weeks w where w.id = p_week_id)
  group by p.id, p.display_name
  order by total_points desc, p.display_name
$$;

-- ============================================================
-- RECOVERY
-- For when the host locks a question by accident. Only works from
-- locked, and only when nothing else is open - reopening should
-- never leave two questions open at once.
-- ============================================================
create or replace function reopen_question(p_question_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week_id    uuid;
  v_status     text;
  v_other_open int;
begin
  select week_id, status into v_week_id, v_status from questions where id = p_question_id;
  if not found then
    raise exception 'Question not found.';
  end if;

  if not is_host_of(v_week_id) then
    raise exception 'Only the host can reopen a question.';
  end if;

  if v_status <> 'locked' then
    raise exception 'Only a locked question can be reopened.';
  end if;

  select count(*) into v_other_open
  from questions
  where week_id = v_week_id and status = 'open' and id <> p_question_id;
  if v_other_open > 0 then
    raise exception 'Lock the current question before reopening another one.';
  end if;

  -- Refresh opened_at so this becomes "current" again even if the
  -- host has already opened and locked a later question in the
  -- meantime - live_state()/host_live_state() pick whichever
  -- open-or-locked question was opened most recently.
  update questions set status = 'open', opened_at = now() where id = p_question_id;
end;
$$;

-- ============================================================
-- FINISHING THE NIGHT
-- Same signature as before - only difference is it now refuses to
-- run with a question still open, and checks the week is actually
-- live first. Players with no responses still get no score row,
-- same as always: the insert only ever touches players who appear
-- in `responses`.
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

  if exists (select 1 from questions where week_id = p_week_id and status = 'open') then
    raise exception 'Lock the open question before ending the night.';
  end if;

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
