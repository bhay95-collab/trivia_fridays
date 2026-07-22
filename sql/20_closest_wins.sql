-- ============================================================
-- TRIVIA FRIDAYS - "CLOSEST WINS" QUESTIONS
-- Paste this whole file into Supabase > SQL Editor > Run.
-- Safe to re-run: constraints are dropped-then-re-added and every
-- function is "create or replace".
--
-- A 'closest' question asks for a number, but unlike 'num' there is
-- no right/wrong at submit time — the winner is whoever lands nearest,
-- and that can't be known until everyone's answer is in. So:
--   * at submit, the answer is stored with verdict 'pending', 0 points
--   * when the host finalises the week, resolve_closest() compares the
--     room: the nearest answer(s) take full marks, everyone else zero
--       (ties all win — generous, like the badges)
-- Because it settles at finalise, the payoff lands with the podium
-- reveal, which makes it a natural question for a host to save for last.
-- A staked joker on a 'closest' question doubles only if that answer
-- wins — the existing finalize doubling handles that for free once the
-- winner's verdict is set to 'correct'.
-- ============================================================

alter table questions drop constraint if exists questions_q_type_check;
alter table questions add constraint questions_q_type_check
  check (q_type in ('mc', 'text', 'tf', 'num', 'order', 'closest'));

-- 'pending' is the holding state a closest answer sits in until the
-- week is finalised and the room is compared.
alter table responses drop constraint if exists responses_verdict_check;
alter table responses add constraint responses_verdict_check
  check (verdict in ('correct', 'partial', 'wrong', 'pending'));

-- ============================================================
-- GRADING gains a 'closest' branch: it just parks the answer as
-- pending. Everything else is identical to sql/19_question_types.sql.
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

  if q.q_type = 'closest' then
    -- winner decided across the room at finalise; hold it for now
    v_verdict := 'pending';
    v_points  := 0;

  elsif q.q_type in ('mc', 'tf') then
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
-- RESOLVE_CLOSEST - compare the room for each closest question and
-- award the nearest answer(s) full marks, everyone else zero. Ties
-- all win. Unparseable or missing answers score zero. Idempotent:
-- it recomputes from answer_raw every time, so re-finalising is safe.
-- ============================================================
create or replace function resolve_closest(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  qrow record;
begin
  if not is_host_of(p_week_id) then raise exception 'Only the host can do that.'; end if;

  for qrow in
    select qq.id, qq.points, k.num_value
    from questions qq
    join answer_keys k on k.question_id = qq.id
    where qq.week_id = p_week_id and qq.q_type = 'closest'
  loop
    with dist as (
      select r.id,
             case
               when (regexp_match(replace(coalesce(r.answer_raw, ''), ',', ''), '-?\d+(?:\.\d+)?'))[1] is null
                 then null
               else abs((regexp_match(replace(coalesce(r.answer_raw, ''), ',', ''), '-?\d+(?:\.\d+)?'))[1]::numeric - qrow.num_value)
             end as d
      from responses r
      where r.question_id = qrow.id
    ),
    best as (select min(d) as md from dist)
    update responses r
    set verdict = case when d.d is not null and d.d = best.md then 'correct' else 'wrong' end,
        points_awarded = case when d.d is not null and d.d = best.md then qrow.points else 0 end,
        reviewed = true
    from dist d cross join best
    where r.id = d.id;
  end loop;
end;
$$;

-- ============================================================
-- FINALISE now resolves closest questions first, then totals the room
-- with the joker doubling (unchanged from sql/17_jokers.sql).
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

  perform resolve_closest(p_week_id);

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

-- ============================================================
-- SAVING - accept 'closest' (a number, no tolerance). Same overload
-- as sql/19_question_types.sql with 'closest' folded into the numeric
-- path.
-- ============================================================
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
  if not is_host_of(p_week_id) then raise exception 'Only the host can edit questions.'; end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then raise exception 'That quiz was not found.'; end if;
  if v_status in ('live', 'closed') then
    raise exception 'Questions cannot be changed once the quiz is live.';
  end if;

  if trim(coalesce(p_prompt, '')) = '' then raise exception 'Write a prompt for the question.'; end if;
  if p_points is null or p_points <= 0 then raise exception 'Points must be a positive number.'; end if;
  if p_q_type not in ('mc', 'text', 'tf', 'num', 'order', 'closest') then
    raise exception 'Unknown question type.';
  end if;

  if p_q_type = 'tf' then
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
      select array_agg(upper(x)) into v_order_keys from jsonb_array_elements_text(coalesce(p_correct_order, '[]'::jsonb)) x;
      if coalesce(array_length(v_order_keys, 1), 0) <> array_length(v_keys, 1)
         or exists (select 1 from unnest(v_order_keys) ok where ok is null)
         or (select count(distinct ok) from unnest(v_order_keys) ok) <> array_length(v_order_keys, 1)
         or exists (select 1 from unnest(v_order_keys) ok where not (ok = any(select upper(kk) from unnest(v_keys) kk)))
      then
        raise exception 'The correct order must list every item exactly once.';
      end if;
      select string_agg(t.txt, ' → ' order by t.ord) into v_correct_text
      from (
        select ok as key, o.ord as ord,
               (select opt->>'text' from jsonb_array_elements(v_options) opt where upper(opt->>'key') = ok) as txt
        from unnest(v_order_keys) with ordinality as o(ok, ord)
      ) t;
    end if;

  elsif p_q_type in ('num', 'closest') then
    if p_num_value is null then raise exception 'Enter the correct number.'; end if;
    if p_q_type = 'num' and p_num_tolerance is not null and p_num_tolerance < 0 then
      raise exception 'Tolerance cannot be negative.';
    end if;
    v_correct_text := trim(to_char(p_num_value, 'FM999999999999990.999999'));

  else -- text
    if trim(coalesce(p_correct_text, '')) = '' then raise exception 'Write the correct answer.'; end if;
    v_correct_text := trim(p_correct_text);
  end if;

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

  insert into answer_keys (question_id, correct_key, correct_text, alternates, num_value, num_tolerance, correct_order)
  values (
    v_id,
    case when p_q_type in ('mc', 'tf') then upper(p_correct_key) else null end,
    case when p_q_type in ('text', 'num', 'order', 'closest') then v_correct_text else null end,
    case when p_q_type = 'text'
      then (select coalesce(array_agg(a) filter (where trim(a) <> ''), '{}') from unnest(coalesce(p_alternates, '{}')) a)
      else '{}'
    end,
    case when p_q_type in ('num', 'closest') then p_num_value else null end,
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

grant execute on function resolve_closest(uuid) to authenticated;
revoke execute on function resolve_closest(uuid) from anon;
