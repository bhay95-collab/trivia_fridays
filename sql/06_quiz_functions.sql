-- ============================================================
-- TRIVIA FRIDAYS - QUIZ BUILDER
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: everything is "create or replace", except the
-- one explicit revoke below, which is safe to repeat too.
--
-- This file replaces submit_answer() from 01_schema.sql so that it
-- shares its grading logic with test_answer() through one function,
-- grade_response() - see the note above that function for why it is
-- locked down so only submit_answer() and test_answer() can call it.
-- ============================================================

-- ============================================================
-- SHARED GRADING LOGIC
-- Identical to the grading half of the old submit_answer() - exact
-- match scores full points, a near miss scores half, pure numbers
-- are never fuzzy matched. submit_answer() and test_answer() both
-- call this and nothing else, so the two can never drift apart.
--
-- This function does NOT check who is calling it or whether the
-- question is open - callers own that. That makes it dangerous to
-- expose directly: anyone could brute-force a multiple choice
-- answer by trying every key and watching for 'correct'. Only
-- submit_answer() and test_answer() may call it, both of which do
-- their own permission checks first. The revoke below stops it
-- being called straight from the browser.
-- ============================================================
create or replace function grade_response(p_question_id uuid, p_answer text)
returns table(verdict text, points numeric)
language plpgsql security definer set search_path = public as $$
declare
  q            questions%rowtype;
  k            answer_keys%rowtype;
  v_given      text;
  v_target     text;
  v_best       int := 999;
  v_dist       int;
  v_verdict    text := 'wrong';
  v_points     numeric(5,2) := 0;
  v_all        text[];
begin
  select * into q from questions where questions.id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;

  select * into k from answer_keys where answer_keys.question_id = p_question_id;
  if not found then raise exception 'No answer key set for this question.'; end if;

  if q.q_type = 'mc' then
    if upper(trim(p_answer)) = upper(trim(coalesce(k.correct_key, ''))) then
      v_verdict := 'correct';
      v_points  := q.points;
    end if;

  else
    v_given := norm_answer(p_answer);
    v_all   := array_append(k.alternates, k.correct_text);

    -- exact match on any accepted answer
    foreach v_target in array v_all loop
      if v_given <> '' and v_given = norm_answer(v_target) then
        v_verdict := 'correct';
        v_points  := q.points;
        exit;
      end if;
    end loop;

    -- near miss = half points, but never for pure numbers
    if v_verdict = 'wrong' and v_given <> '' and v_given !~ '^[0-9 ]+$' then
      foreach v_target in array v_all loop
        v_target := norm_answer(v_target);
        if v_target <> '' and v_target !~ '^[0-9 ]+$' then
          v_dist := levenshtein(v_given, v_target);
          if v_dist < v_best then v_best := v_dist; end if;
        end if;
      end loop;

      if (length(v_given) >= 5 and v_best <= 2)
         or (length(v_given) between 3 and 4 and v_best <= 1) then
        v_verdict := 'partial';
        v_points  := round(q.points / 2, 2);
      end if;
    end if;
  end if;

  return query select v_verdict, v_points;
end;
$$;

revoke execute on function grade_response(uuid, text) from public;

-- Grades and records an answer. Now just a thin wrapper: the
-- signed-in and question-is-open checks, and the one-response-per-
-- player rule, are the only things left that are specific to a real
-- submission rather than a test.
create or replace function submit_answer(p_question_id uuid, p_answer text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me      uuid := me();
  v_status  text;
  v_verdict text;
  v_points  numeric;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  select status into v_status from questions where id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;
  if v_status <> 'open' then raise exception 'That question is not open.'; end if;

  select verdict, points into v_verdict, v_points from grade_response(p_question_id, p_answer);

  insert into responses (question_id, player_id, answer_raw, verdict, points_awarded)
  values (p_question_id, v_me, p_answer, v_verdict, v_points);

  return 'submitted';   -- deliberately tells the player nothing about the result
exception
  when unique_violation then
    raise exception 'You already answered that one.';
end;
$$;

-- Runs a sample answer through grade_response() without writing a
-- response, so the host can check their answer key before the
-- night. Host of that question's week, or an admin, only.
create or replace function test_answer(p_question_id uuid, p_sample text)
returns table(verdict text, points numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_week uuid;
begin
  select week_id into v_week from questions where id = p_question_id;
  if not found then
    raise exception 'Question not found.';
  end if;

  if not is_host_of(v_week) then
    raise exception 'Only the host can test an answer.';
  end if;

  return query select * from grade_response(p_question_id, p_sample);
end;
$$;

-- ============================================================
-- BUILDING THE QUIZ (host of the week, or an admin)
-- ============================================================

-- Creates a question when p_question_id is null, otherwise updates
-- it. The question and its answer key are written together so they
-- can never end up out of step with each other.
drop function if exists host_save_question(uuid, uuid, text, text, numeric, jsonb, text, text, text[]);

create or replace function host_save_question(
  p_question_id  uuid,
  p_week_id      uuid,
  p_q_type       text,
  p_prompt       text,
  p_points       numeric,
  p_options      jsonb default null,
  p_correct_key  text default null,
  p_correct_text text default null,
  p_alternates   text[] default '{}',
  p_media        jsonb default '[]'::jsonb
)
returns table(id uuid, q_number int)
language plpgsql security definer set search_path = public as $$
declare
  v_status         text;
  v_id             uuid;
  v_q_number       int;
  v_existing_week  uuid;
  v_keys           text[];
  v_media_item     jsonb;
  v_media_type     text;
  v_media_url      text;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host can edit questions.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz night was not found.';
  end if;
  if v_status in ('live', 'closed') then
    raise exception 'Questions cannot be changed once the night is live.';
  end if;

  if trim(coalesce(p_prompt, '')) = '' then
    raise exception 'Write a prompt for the question.';
  end if;

  if p_points is null or p_points <= 0 then
    raise exception 'Points must be a positive number.';
  end if;

  if p_q_type not in ('mc', 'text') then
    raise exception 'Unknown question type.';
  end if;

  if p_q_type = 'mc' then
    if p_options is null or jsonb_typeof(p_options) <> 'array'
       or jsonb_array_length(p_options) < 2 or jsonb_array_length(p_options) > 6 then
      raise exception 'Multiple choice needs between 2 and 6 options.';
    end if;

    select array_agg(opt->>'key') into v_keys from jsonb_array_elements(p_options) as opt;

    if exists (select 1 from unnest(v_keys) k where k is null or trim(k) = '') then
      raise exception 'Every option needs a key.';
    end if;

    if (select count(distinct k) from unnest(v_keys) k) <> array_length(v_keys, 1) then
      raise exception 'Option keys must be unique.';
    end if;

    if exists (
      select 1 from jsonb_array_elements(p_options) as opt
      where trim(coalesce(opt->>'text', '')) = ''
    ) then
      raise exception 'Every option needs its own text.';
    end if;

    if p_correct_key is null or not (p_correct_key = any(v_keys)) then
      raise exception 'Pick which option is correct.';
    end if;
  else
    if trim(coalesce(p_correct_text, '')) = '' then
      raise exception 'Write the correct answer.';
    end if;
  end if;

  if p_question_id is null then
    select coalesce(max(qq.q_number), 0) + 1 into v_q_number from questions qq where qq.week_id = p_week_id;

    insert into questions (week_id, q_number, q_type, prompt, options, points)
    values (p_week_id, v_q_number, p_q_type, trim(p_prompt),
            case when p_q_type = 'mc' then p_options else null end, p_points)
    returning questions.id into v_id;
  else
    select qq.week_id, qq.q_number into v_existing_week, v_q_number from questions qq where qq.id = p_question_id;
    if not found then
      raise exception 'Question not found.';
    end if;
    if v_existing_week <> p_week_id then
      raise exception 'That question does not belong to this week.';
    end if;

    update questions
    set q_type = p_q_type,
        prompt = trim(p_prompt),
        options = case when p_q_type = 'mc' then p_options else null end,
        points = p_points
    where questions.id = p_question_id;

    v_id := p_question_id;
  end if;

  insert into answer_keys (question_id, correct_key, correct_text, alternates)
  values (
    v_id,
    case when p_q_type = 'mc' then p_correct_key else null end,
    case when p_q_type = 'text' then trim(p_correct_text) else null end,
    case when p_q_type = 'text'
      then (select coalesce(array_agg(a) filter (where trim(a) <> ''), '{}') from unnest(coalesce(p_alternates, '{}')) a)
      else '{}'
    end
  )
  on conflict (question_id) do update
  set correct_key  = excluded.correct_key,
      correct_text = excluded.correct_text,
      alternates   = excluded.alternates;

  delete from question_media where question_id = v_id;
  if p_media is not null and jsonb_typeof(p_media) = 'array' then
    for v_media_item in select * from jsonb_array_elements(p_media)
    loop
      v_media_url := trim(coalesce(v_media_item->>'url', ''));
      v_media_type := lower(coalesce(v_media_item->>'media_type', 'image'));

      if v_media_url <> '' then
        if v_media_type not in ('audio', 'image', 'video') then
          raise exception 'Media must be audio, image, or video.';
        end if;
        if v_media_url !~* '^https://' then
          raise exception 'Media links must be full HTTPS URLs.';
        end if;

        insert into question_media (question_id, media_type, source_type, url, caption, sort_order)
        values (
          v_id,
          v_media_type,
          'url',
          v_media_url,
          coalesce(v_media_item->>'caption', ''),
          coalesce((v_media_item->>'sort_order')::int, 0)
        );
      end if;
    end loop;
  end if;

  return query select v_id, v_q_number;
end;
$$;

-- Deletes a question and closes the numbering gap behind it.
create or replace function host_delete_question(p_question_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week_id uuid;
  v_number  int;
  v_status  text;
begin
  select qq.week_id, qq.q_number into v_week_id, v_number from questions qq where qq.id = p_question_id;
  if not found then
    raise exception 'Question not found.';
  end if;

  if not is_host_of(v_week_id) then
    raise exception 'Only the host can edit questions.';
  end if;

  select w.status into v_status from weeks w where w.id = v_week_id;
  if v_status in ('live', 'closed') then
    raise exception 'Questions cannot be changed once the night is live.';
  end if;

  delete from questions where id = p_question_id;

  -- Shift the numbers above the gap down by one. Stage through
  -- negative numbers first so the unique (week_id, q_number)
  -- constraint never sees a transient duplicate, whatever order
  -- Postgres happens to touch the rows in.
  update questions
  set q_number = -q_number
  where week_id = v_week_id and q_number > v_number;

  update questions
  set q_number = -q_number - 1
  where week_id = v_week_id and q_number < 0;
end;
$$;

-- Renumbers questions to match the order the host dragged them into.
create or replace function host_reorder_questions(p_week_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_count  int;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host can edit questions.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz night was not found.';
  end if;
  if v_status in ('live', 'closed') then
    raise exception 'Questions cannot be changed once the night is live.';
  end if;

  select count(*) into v_count from questions qq where qq.week_id = p_week_id;

  if coalesce(array_length(p_ordered_ids, 1), 0) <> v_count
     or (select count(distinct qid) from unnest(p_ordered_ids) qid) <> v_count
     or exists (
       select 1 from unnest(p_ordered_ids) qid
       where not exists (select 1 from questions qq where qq.id = qid and qq.week_id = p_week_id)
     )
  then
    raise exception 'That list does not match the questions in this quiz.';
  end if;

  -- Same negative-staging trick as host_delete_question, so a full
  -- reshuffle never trips the unique constraint mid-statement.
  update questions
  set q_number = -(ord.rn)
  from unnest(p_ordered_ids) with ordinality as ord(qid, rn)
  where questions.id = ord.qid and questions.week_id = p_week_id;

  update questions
  set q_number = -q_number
  where week_id = p_week_id and q_number < 0;
end;
$$;

-- Every question for a week, answer keys included. The only route
-- by which answer keys are meant to be read from the app. Returns
-- no rows at all to anyone who isn't the host of that week or an
-- admin.
create or replace function host_quiz(p_week_id uuid)
returns table(
  id           uuid,
  q_number     int,
  q_type       text,
  prompt       text,
  options      jsonb,
  points       numeric,
  status       text,
  correct_key  text,
  correct_text text,
  alternates   text[],
  media        jsonb
)
language sql stable security definer set search_path = public as $$
  select
    q.id, q.q_number, q.q_type, q.prompt, q.options, q.points, q.status,
    k.correct_key, k.correct_text, k.alternates,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'media_type', m.media_type,
      'source_type', m.source_type,
      'url', m.url,
      'caption', m.caption,
      'sort_order', m.sort_order
    ) order by m.sort_order, m.created_at)
    from question_media m where m.question_id = q.id), '[]'::jsonb) as media
  from questions q
  left join answer_keys k on k.question_id = q.id
  where q.week_id = p_week_id and is_host_of(p_week_id)
  order by q.q_number
$$;
