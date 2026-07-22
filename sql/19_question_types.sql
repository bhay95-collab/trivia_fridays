-- ============================================================
-- TRIVIA FRIDAYS - MORE QUESTION TYPES (True/False, Numeric, Order)
-- Paste this whole file into Supabase > SQL Editor > Run.
-- Safe to re-run: columns are added "if not exists", the check
-- constraint is dropped-then-re-added, and every function is
-- "create or replace" (host_quiz is dropped first because its
-- return columns change).
--
-- Three new q_types join 'mc' and 'text':
--   tf     - True/False. Graded exactly like multiple choice.
--   num    - a number. Exact value = full marks; within a tolerance
--            band = half; otherwise wrong. Graded at submit.
--   order  - put items in the right order. All positions right = full;
--            at least half right = half; otherwise wrong. Graded at
--            submit against the authored sequence.
-- The machine-readable key lives in new answer_keys columns; a plain
-- correct_text is also stored for num/order so the reveal and review
-- screens keep reading exactly the one column they always have.
-- ============================================================

alter table answer_keys add column if not exists num_value     numeric;
alter table answer_keys add column if not exists num_tolerance numeric;
alter table answer_keys add column if not exists correct_order jsonb;

alter table questions drop constraint if exists questions_q_type_check;
alter table questions add constraint questions_q_type_check
  check (q_type in ('mc', 'text', 'tf', 'num', 'order'));

-- ============================================================
-- GRADING, now branching per type. mc/tf are an exact key match;
-- num parses the first number out of the answer; order compares the
-- submitted key sequence position by position; text keeps the
-- forgiving fuzzy match it always had.
-- ============================================================
create or replace function grade_response(p_question_id uuid, p_answer text)
returns table(verdict text, points numeric)
language plpgsql security definer set search_path = public as $$
declare
  q             questions%rowtype;
  k             answer_keys%rowtype;
  v_given       text;
  v_target      text;
  v_best        int := 999;
  v_dist        int;
  v_verdict     text := 'wrong';
  v_points      numeric(5,2) := 0;
  v_all         text[];
  v_numtext     text;
  v_num         numeric;
  v_player_keys text[];
  v_correct     text[];
  v_total       int;
  v_hits        int := 0;
  i             int;
begin
  select * into q from questions where questions.id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;

  select * into k from answer_keys where answer_keys.question_id = p_question_id;
  if not found then raise exception 'No answer key set for this question.'; end if;

  if q.q_type in ('mc', 'tf') then
    if upper(trim(p_answer)) = upper(trim(coalesce(k.correct_key, ''))) then
      v_verdict := 'correct';
      v_points  := q.points;
    end if;

  elsif q.q_type = 'num' then
    v_numtext := (regexp_match(replace(coalesce(p_answer, ''), ',', ''), '-?\d+(?:\.\d+)?'))[1];
    if v_numtext is not null then
      v_num := v_numtext::numeric;
      if v_num = k.num_value then
        v_verdict := 'correct';
        v_points  := q.points;
      elsif k.num_tolerance is not null and abs(v_num - k.num_value) <= k.num_tolerance then
        v_verdict := 'partial';
        v_points  := round(q.points / 2, 2);
      end if;
    end if;

  elsif q.q_type = 'order' then
    v_player_keys := string_to_array(upper(regexp_replace(coalesce(p_answer, ''), '\s', '', 'g')), ',');
    select array_agg(upper(x)) into v_correct from jsonb_array_elements_text(coalesce(k.correct_order, '[]'::jsonb)) x;
    v_total := coalesce(array_length(v_correct, 1), 0);
    if v_total > 0 then
      for i in 1..v_total loop
        if i <= coalesce(array_length(v_player_keys, 1), 0) and v_player_keys[i] = v_correct[i] then
          v_hits := v_hits + 1;
        end if;
      end loop;
      if v_hits = v_total then
        v_verdict := 'correct';
        v_points  := q.points;
      elsif v_hits * 2 >= v_total then
        v_verdict := 'partial';
        v_points  := round(q.points / 2, 2);
      end if;
    end if;

  else -- text
    v_given := norm_answer(p_answer);
    v_all   := array_append(k.alternates, k.correct_text);

    foreach v_target in array v_all loop
      if v_given <> '' and v_given = norm_answer(v_target) then
        v_verdict := 'correct';
        v_points  := q.points;
        exit;
      end if;
    end loop;

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

-- ============================================================
-- SAVING A QUESTION - one more overload with the numeric/order key
-- fields. Drops the previous signature first. Validates each type and
-- stores a human-readable correct_text for num/order so every read
-- path downstream is unchanged.
-- ============================================================
drop function if exists host_save_question(uuid, uuid, text, text, numeric, jsonb, text, text, text[], jsonb);

create or replace function host_save_question(
  p_question_id   uuid,
  p_week_id       uuid,
  p_q_type        text,
  p_prompt        text,
  p_points        numeric,
  p_options       jsonb   default null,
  p_correct_key   text    default null,
  p_correct_text  text    default null,
  p_alternates    text[]  default '{}',
  p_media         jsonb   default '[]'::jsonb,
  p_num_value     numeric default null,
  p_num_tolerance numeric default null,
  p_correct_order jsonb   default null
)
returns table(id uuid, q_number int)
language plpgsql security definer set search_path = public as $$
declare
  v_status         text;
  v_id             uuid;
  v_q_number       int;
  v_existing_week  uuid;
  v_keys           text[];
  v_order_keys     text[];
  v_options        jsonb := p_options;
  v_correct_text   text;
  v_media_item     jsonb;
  v_media_type     text;
  v_media_url      text;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host can edit questions.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then raise exception 'That quiz was not found.'; end if;
  if v_status in ('live', 'closed') then
    raise exception 'Questions cannot be changed once the quiz is live.';
  end if;

  if trim(coalesce(p_prompt, '')) = '' then
    raise exception 'Write a prompt for the question.';
  end if;
  if p_points is null or p_points <= 0 then
    raise exception 'Points must be a positive number.';
  end if;
  if p_q_type not in ('mc', 'text', 'tf', 'num', 'order') then
    raise exception 'Unknown question type.';
  end if;

  -- ---- per-type validation ----
  if p_q_type = 'tf' then
    -- options are fixed; the host only picks which side is correct
    v_options := '[{"key":"T","text":"True"},{"key":"F","text":"False"}]'::jsonb;
    if upper(coalesce(p_correct_key, '')) not in ('T', 'F') then
      raise exception 'Pick True or False as the answer.';
    end if;

  elsif p_q_type in ('mc', 'order') then
    if v_options is null or jsonb_typeof(v_options) <> 'array'
       or jsonb_array_length(v_options) < 2 or jsonb_array_length(v_options) > 6 then
      raise exception 'This question needs between 2 and 6 items.';
    end if;

    select array_agg(opt->>'key') into v_keys from jsonb_array_elements(v_options) as opt;
    if exists (select 1 from unnest(v_keys) kk where kk is null or trim(kk) = '') then
      raise exception 'Every item needs a key.';
    end if;
    if (select count(distinct kk) from unnest(v_keys) kk) <> array_length(v_keys, 1) then
      raise exception 'Item keys must be unique.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_options) as opt where trim(coalesce(opt->>'text', '')) = '') then
      raise exception 'Every item needs its own text.';
    end if;

    if p_q_type = 'mc' then
      if p_correct_key is null or not (p_correct_key = any(v_keys)) then
        raise exception 'Pick which option is correct.';
      end if;
    else
      -- order: correct_order must be exactly the item keys, each once
      select array_agg(upper(x)) into v_order_keys from jsonb_array_elements_text(coalesce(p_correct_order, '[]'::jsonb)) x;
      if coalesce(array_length(v_order_keys, 1), 0) <> array_length(v_keys, 1)
         or exists (select 1 from unnest(v_order_keys) ok where ok is null)
         or (select count(distinct ok) from unnest(v_order_keys) ok) <> array_length(v_order_keys, 1)
         or exists (select 1 from unnest(v_order_keys) ok where not (ok = any(select upper(kk) from unnest(v_keys) kk)))
      then
        raise exception 'The correct order must list every item exactly once.';
      end if;
      -- correct_text: item texts in the correct order, for the reveal
      select string_agg(t.txt, ' → ' order by t.ord) into v_correct_text
      from (
        select ok as key, o.ord as ord,
               (select opt->>'text' from jsonb_array_elements(v_options) opt where upper(opt->>'key') = ok) as txt
        from unnest(v_order_keys) with ordinality as o(ok, ord)
      ) t;
    end if;

  elsif p_q_type = 'num' then
    if p_num_value is null then
      raise exception 'Enter the correct number.';
    end if;
    if p_num_tolerance is not null and p_num_tolerance < 0 then
      raise exception 'Tolerance cannot be negative.';
    end if;
    v_correct_text := trim(to_char(p_num_value, 'FM999999999999990.999999'));

  else -- text
    if trim(coalesce(p_correct_text, '')) = '' then
      raise exception 'Write the correct answer.';
    end if;
    v_correct_text := trim(p_correct_text);
  end if;

  -- ---- upsert the question row ----
  if p_question_id is null then
    select coalesce(max(qq.q_number), 0) + 1 into v_q_number from questions qq where qq.week_id = p_week_id;
    insert into questions (week_id, q_number, q_type, prompt, options, points)
    values (p_week_id, v_q_number, p_q_type, trim(p_prompt),
            case when p_q_type in ('mc', 'tf', 'order') then v_options else null end, p_points)
    returning questions.id into v_id;
  else
    select qq.week_id, qq.q_number into v_existing_week, v_q_number from questions qq where qq.id = p_question_id;
    if not found then raise exception 'Question not found.'; end if;
    if v_existing_week <> p_week_id then raise exception 'That question does not belong to this week.'; end if;

    update questions
    set q_type = p_q_type,
        prompt = trim(p_prompt),
        options = case when p_q_type in ('mc', 'tf', 'order') then v_options else null end,
        points = p_points
    where questions.id = p_question_id;
    v_id := p_question_id;
  end if;

  -- ---- upsert the answer key ----
  insert into answer_keys (question_id, correct_key, correct_text, alternates, num_value, num_tolerance, correct_order)
  values (
    v_id,
    case when p_q_type in ('mc', 'tf') then upper(p_correct_key) else null end,
    case when p_q_type in ('text', 'num', 'order') then v_correct_text else null end,
    case when p_q_type = 'text'
      then (select coalesce(array_agg(a) filter (where trim(a) <> ''), '{}') from unnest(coalesce(p_alternates, '{}')) a)
      else '{}'
    end,
    case when p_q_type = 'num' then p_num_value else null end,
    case when p_q_type = 'num' then coalesce(p_num_tolerance, 0) else null end,
    case when p_q_type = 'order' then p_correct_order else null end
  )
  on conflict (question_id) do update
  set correct_key   = excluded.correct_key,
      correct_text  = excluded.correct_text,
      alternates    = excluded.alternates,
      num_value     = excluded.num_value,
      num_tolerance = excluded.num_tolerance,
      correct_order = excluded.correct_order;

  -- ---- media (unchanged) ----
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
        values (v_id, v_media_type, 'url', v_media_url,
                coalesce(v_media_item->>'caption', ''),
                coalesce((v_media_item->>'sort_order')::int, 0));
      end if;
    end loop;
  end if;

  return query select v_id, v_q_number;
end;
$$;

-- ============================================================
-- HOST QUIZ now returns the numeric/order key fields too, so the
-- builder can reload and edit them. Columns added at the end, so
-- every existing reader keeps working.
-- ============================================================
drop function if exists host_quiz(uuid);

create or replace function host_quiz(p_week_id uuid)
returns table(
  id            uuid,
  q_number      int,
  q_type        text,
  prompt        text,
  options       jsonb,
  points        numeric,
  status        text,
  correct_key   text,
  correct_text  text,
  alternates    text[],
  media         jsonb,
  num_value     numeric,
  num_tolerance numeric,
  correct_order jsonb
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
    from question_media m where m.question_id = q.id), '[]'::jsonb) as media,
    k.num_value, k.num_tolerance, k.correct_order
  from questions q
  left join answer_keys k on k.question_id = q.id
  where q.week_id = p_week_id and is_host_of(p_week_id)
  order by q.q_number
$$;
