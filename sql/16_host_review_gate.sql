-- ============================================================
-- TRIVIA FRIDAYS - HOST REVIEW GATE ON FREE-TEXT SCORING
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: the columns are added with "if not exists", the
-- backfill only ever tightens (never loosens) reviewed, and every
-- function is "create or replace" with the same signature it
-- already had, or is brand new.
--
-- The fuzzy matcher in grade_response() is deliberately forgiving -
-- that's the whole point, so a host doesn't have to type every
-- misspelling into the answer key by hand. But "forgiving" means it
-- sometimes calls a real miss a partial, or a real match a miss.
-- Multiple choice never has this problem (it's an exact key match),
-- and an exact free-text match isn't in question either. So: a
-- response only needs a human look when it's free text AND the
-- grader didn't call it fully correct.
--
-- Before this file, close_week() wrote straight into week_scores
-- the moment the host ended the quiz - before the review screen
-- even opened. This moves that write into a new step,
-- finalize_week_scores(), which refuses to run while any free-text
-- response like that is still unreviewed. Nothing else on the
-- leaderboard/season-stats side needs to change: they already only
-- ever read from week_scores, so a week with no week_scores rows
-- yet simply doesn't show up there until it's finalised.
-- ============================================================

-- ============================================================
-- TRACKING WHAT'S BEEN LOOKED AT
-- Defaults to true so multiple choice and exact free-text matches
-- never need a host to touch them. submit_answer() below sets it
-- false at the point a free-text answer grades as anything other
-- than 'correct'. override_response() always sets it true - a host
-- who has just chosen a verdict has, by definition, reviewed it.
-- ============================================================
alter table responses add column if not exists reviewed boolean not null default true;

update responses r
set reviewed = false
from questions q
where q.id = r.question_id
  and q.q_type = 'text'
  and r.verdict <> 'correct'
  and not r.overridden;

alter table weeks add column if not exists scores_finalized boolean not null default false;

-- ============================================================
-- GRADING NOW STAMPS reviewed
-- Same shape as the submit_answer() from sql/08_final_submission.sql
-- (still an upsert, still refuses a closed submission or a locked
-- question), plus the q_type lookup needed to know whether this
-- answer can even be in question, and setting reviewed on both the
-- insert and the update branch of the upsert - a changed answer
-- gets re-judged same as a changed verdict would.
-- ============================================================
create or replace function submit_answer(p_question_id uuid, p_answer text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := me();
  v_week     uuid;
  v_host     uuid;
  v_status   text;
  v_q_type   text;
  v_verdict  text;
  v_points   numeric;
  v_reviewed boolean;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  select q.week_id, q.status, q.q_type into v_week, v_status, v_q_type from questions q where q.id = p_question_id;
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
  v_reviewed := (v_q_type <> 'text' or v_verdict = 'correct');

  insert into responses (question_id, player_id, answer_raw, verdict, points_awarded, reviewed)
  values (p_question_id, v_me, p_answer, v_verdict, v_points, v_reviewed)
  on conflict (question_id, player_id) do update
  set answer_raw     = excluded.answer_raw,
      verdict        = excluded.verdict,
      points_awarded = excluded.points_awarded,
      overridden     = false, -- a changed answer supersedes any earlier host override
      reviewed       = excluded.reviewed;

  return 'saved';
end;
$$;

-- ============================================================
-- HOW MANY ANSWERS STILL NEED A HUMAN LOOK
-- Drives the review screen's gate on revealing the podium. Host of
-- the week (or an admin) only, same as every other host_* read.
-- ============================================================
create or replace function host_review_status(p_week_id uuid)
returns table(to_review int, still_pending int)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where q.q_type = 'text' and r.verdict <> 'correct')::int,
    count(*) filter (where q.q_type = 'text' and r.verdict <> 'correct' and not r.reviewed)::int
  from responses r
  join questions q on q.id = r.question_id
  where q.week_id = p_week_id and is_host_of(p_week_id)
$$;

-- ============================================================
-- REVIEWING AFTER THE QUIZ
-- Same as the override_response() from sql/08_final_submission.sql,
-- with two changes: it always marks the response reviewed (choosing
-- a verdict, even the one it already had, is the review), and it
-- only re-syncs week_scores once finalize_week_scores() has already
-- run for this week - before that, there's nothing in week_scores
-- yet to re-sync.
-- ============================================================
create or replace function override_response(p_response_id uuid, p_verdict text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week      uuid;
  v_pts       numeric(5,2);
  v_player    uuid;
  v_finalized boolean;
begin
  select q.week_id, q.points, r.player_id into v_week, v_pts, v_player
  from responses r join questions q on q.id = r.question_id
  where r.id = p_response_id;

  if v_week is null then raise exception 'Response not found.'; end if;
  if not is_host_of(v_week) then raise exception 'Only the host can change scores.'; end if;

  update responses
  set verdict = p_verdict,
      overridden = true,
      reviewed = true,
      points_awarded = case p_verdict
                         when 'correct' then v_pts
                         when 'partial' then round(v_pts / 2, 2)
                         else 0 end
  where id = p_response_id;

  select scores_finalized into v_finalized from weeks where id = v_week;
  if v_finalized then
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
-- CLOSING THE QUIZ NO LONGER TOUCHES week_scores
-- Still sweeps in anyone who answered but never clicked Submit,
-- still locks every question and marks the week closed - closing
-- is what makes the review screen safe to open. Scoring the room is
-- a separate, later step now: finalize_week_scores() below.
-- ============================================================
create or replace function close_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_host_of(p_week_id) then raise exception 'Only the host can close the week.'; end if;

  select status into v_status from weeks where id = p_week_id;
  if not found then raise exception 'That quiz was not found.'; end if;
  if v_status <> 'live' then raise exception 'This quiz is not live.'; end if;

  insert into week_submissions (week_id, player_id)
  select distinct p_week_id, r.player_id
  from responses r
  join questions q on q.id = r.question_id
  where q.week_id = p_week_id
  on conflict (week_id, player_id) do nothing;

  update questions set status = 'locked' where week_id = p_week_id;
  update weeks set status = 'closed' where id = p_week_id;
end;
$$;

-- ============================================================
-- SCORING THE ROOM - now its own step, gated on review
-- Refuses while any free-text response outside a straight 'correct'
-- still has reviewed = false. Safe to call again later (e.g. after
-- an override changes a total) - it just recomputes and re-marks
-- the week finalised, the same as close_week() used to do inline.
-- ============================================================
create or replace function finalize_week_scores(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_pending int;
begin
  if not is_host_of(p_week_id) then raise exception 'Only the host can finalise scores.'; end if;

  select status into v_status from weeks where id = p_week_id;
  if not found then raise exception 'That quiz was not found.'; end if;
  if v_status <> 'closed' then raise exception 'End the quiz before finalising scores.'; end if;

  select still_pending into v_pending from host_review_status(p_week_id);

  if coalesce(v_pending, 0) > 0 then
    raise exception '% free-text % still need review before scores go final.',
      v_pending, case when v_pending = 1 then 'answer' else 'answers' end;
  end if;

  delete from week_scores where week_id = p_week_id;

  insert into week_scores (week_id, player_id, points, attended)
  select p_week_id, r.player_id, sum(r.points_awarded), true
  from responses r
  join questions q on q.id = r.question_id
  where q.week_id = p_week_id
  group by r.player_id;

  update weeks set scores_finalized = true where id = p_week_id;
end;
$$;

-- ============================================================
-- GRANTS - reads and writes for signed-in hosts only, matching the
-- pattern set in sql/14_season_stats.sql. Every function above
-- carries its own is_host_of()/me() check regardless.
-- ============================================================
grant execute on function host_review_status(uuid)    to authenticated;
grant execute on function finalize_week_scores(uuid)  to authenticated;

revoke execute on function host_review_status(uuid)   from anon;
revoke execute on function finalize_week_scores(uuid) from anon;
