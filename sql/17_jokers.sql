-- ============================================================
-- TRIVIA FRIDAYS - JOKERS ("double or nothing")
-- Paste this whole file into Supabase > SQL Editor > Run.
-- Safe to re-run: the table is created "if not exists", every
-- policy is dropped-then-created, and every function is
-- "create or replace" with the same signature it already had
-- (or is brand new, like set_joker()).
--
-- Each player gets ONE joker per week. They stake it on a single
-- question before they submit their final answers. At the reveal:
--   * the jokered question graded 'correct'  -> points DOUBLE
--   * anything else (partial, wrong, blank)  -> that question = 0
-- It is a true double-or-nothing, decided by data the grader
-- already stored - the stake itself leaks nothing, because it is
-- chosen before submission when the player still knows nothing
-- about whether they were right (same invariant submit_answer()
-- has always protected).
--
-- The doubling is applied ONLY where a week's final total is
-- written into week_scores - finalize_week_scores() and the
-- single-player re-sync inside override_response(). It is
-- deliberately kept OUT of live_standings(), so the in-progress
-- board never betrays, before the reveal, whether a stake landed.
-- ============================================================

-- ============================================================
-- ONE STAKE PER PLAYER PER WEEK
-- Written only by set_joker() below. Players read their own row;
-- the host of the week reads the room (to show stakes on the big
-- screen). No direct insert/update/delete policy exists, so the
-- security-definer RPC is the only writer - same shape as the
-- responses table.
-- ============================================================
create table if not exists question_jokers (
  week_id     uuid not null references weeks(id)     on delete cascade,
  player_id   uuid not null references players(id)   on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (week_id, player_id)
);

alter table question_jokers enable row level security;

drop policy if exists joker_read on question_jokers;
create policy joker_read on question_jokers for select
  using (player_id = me() or is_host_of(week_id));

-- ============================================================
-- STAKING (and un-staking) THE JOKER
-- p_question_id null  -> clear the stake for this week.
-- p_question_id set   -> stake (or move) it onto that question.
-- Refuses once the player has submitted their final answers, so a
-- stake is locked at exactly the same moment answers are.
-- ============================================================
create or replace function set_joker(p_week_id uuid, p_question_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := me();
  v_status   text;
  v_host     uuid;
  v_q_week   uuid;
  v_q_status text;
begin
  if v_me is null then raise exception 'Sign in to play.'; end if;

  select w.status, w.host_id into v_status, v_host from weeks w where w.id = p_week_id;
  if not found then raise exception 'That quiz was not found.'; end if;
  if v_status <> 'live' then raise exception 'Jokers can only be staked while the quiz is live.'; end if;
  if v_host = v_me then raise exception 'The host does not play.'; end if;

  if exists (select 1 from week_submissions s where s.week_id = p_week_id and s.player_id = v_me) then
    raise exception 'You have already submitted - the joker is locked in.';
  end if;

  if p_question_id is null then
    delete from question_jokers where week_id = p_week_id and player_id = v_me;
    return;
  end if;

  select q.week_id, q.status into v_q_week, v_q_status from questions q where q.id = p_question_id;
  if not found or v_q_week <> p_week_id then
    raise exception 'That question is not in this quiz.';
  end if;
  if v_q_status not in ('open', 'locked') then
    raise exception 'You can only stake the joker on a question that is in play.';
  end if;

  insert into question_jokers (week_id, player_id, question_id)
  values (p_week_id, v_me, p_question_id)
  on conflict (week_id, player_id) do update set question_id = excluded.question_id,
                                                 created_at  = now();
end;
$$;

grant execute on function set_joker(uuid, uuid) to authenticated;
revoke execute on function set_joker(uuid, uuid) from anon;

-- ============================================================
-- LIVE STATE NOW CARRIES THE STAKE
-- Same shape as sql/13_readiness_hardening.sql's live_state(),
-- plus a trailing my_joker boolean: true on the one question this
-- player has staked their joker on. Present in both the answering
-- (browse) and the submitted (reveal) branches, so the Play page
-- can show the stake while choosing and the doubled/zeroed result
-- at the reveal.
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
  my_points        numeric,
  media            jsonb,
  my_joker         boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me          uuid := me();
  v_week_status text;
  v_total       int;
  v_submitted   boolean;
  v_open_count  int;
  v_joker_qid   uuid;
begin
  if v_me is null then
    raise exception 'Sign in to play.';
  end if;

  select w.status into v_week_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;

  select count(*) into v_total from questions qq where qq.week_id = p_week_id;
  v_submitted := exists (select 1 from week_submissions s where s.week_id = p_week_id and s.player_id = v_me);
  select j.question_id into v_joker_qid
  from question_jokers j where j.week_id = p_week_id and j.player_id = v_me;

  if v_submitted then
    return query
      select v_week_status, v_total, true, q.id, q.q_number, q.q_type, q.prompt, q.options, q.points,
             r.answer_raw, k.correct_key, k.correct_text, r.verdict, r.points_awarded,
             coalesce((select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'media_type', m.media_type,
               'source_type', m.source_type,
               'url', m.url,
               'caption', m.caption,
               'sort_order', m.sort_order
             ) order by m.sort_order, m.created_at)
             from question_media m where m.question_id = q.id), '[]'::jsonb),
             (q.id = v_joker_qid)
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
                        null::numeric, null::text, null::text, null::text, null::text, null::numeric, null::jsonb,
                        false;
    return;
  end if;

  return query
    select v_week_status, v_total, false, q.id, q.q_number, q.q_type, q.prompt, q.options, q.points,
           r.answer_raw, null::text, null::text, null::text, null::numeric,
           coalesce((select jsonb_agg(jsonb_build_object(
             'id', m.id,
             'media_type', m.media_type,
             'source_type', m.source_type,
             'url', m.url,
             'caption', m.caption,
             'sort_order', m.sort_order
           ) order by m.sort_order, m.created_at)
           from question_media m where m.question_id = q.id), '[]'::jsonb),
           (q.id = v_joker_qid)
    from questions q
    left join responses r on r.question_id = q.id and r.player_id = v_me
    where q.week_id = p_week_id and q.status = 'open'
    order by q.q_number;
end;
$$;

-- ============================================================
-- SCORING NOW HONOURS THE JOKER
-- effective points per response:
--   jokered question, graded 'correct' -> points_awarded * 2
--   jokered question, anything else    -> 0
--   every other question               -> points_awarded
-- Applied in the two places a final week total is written:
-- finalize_week_scores() (the whole room) and the single-player
-- re-sync inside override_response(). Both are otherwise identical
-- to sql/16_host_review_gate.sql.
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
  select p_week_id, r.player_id,
         sum(case
               when jk.question_id = r.question_id
                 then case when r.verdict = 'correct' then r.points_awarded * 2 else 0 end
               else r.points_awarded
             end), true
  from responses r
  join questions q on q.id = r.question_id
  left join question_jokers jk on jk.week_id = p_week_id and jk.player_id = r.player_id
  where q.week_id = p_week_id
  group by r.player_id;

  update weeks set scores_finalized = true where id = p_week_id;
end;
$$;

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
    select v_week, r.player_id,
           sum(case
                 when jk.question_id = r.question_id
                   then case when r.verdict = 'correct' then r.points_awarded * 2 else 0 end
                 else r.points_awarded
               end), true
    from responses r
    join questions q on q.id = r.question_id
    left join question_jokers jk on jk.week_id = v_week and jk.player_id = r.player_id
    where q.week_id = v_week and r.player_id = v_player
    group by r.player_id
    on conflict (week_id, player_id) do update set points = excluded.points;
  end if;
end;
$$;
