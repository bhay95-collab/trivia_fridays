-- ============================================================
-- TRIVIA FRIDAYS - DROP "NIGHT" FROM THE WORDING
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: every function is "create or replace" with the
-- exact signature it already had. Wording only - no logic changed
-- anywhere in this file.
--
-- The quiz still happens every Friday, just during the work day
-- rather than in the evening, so every message that said "night" -
-- "quiz night", "this night is not live", "start the night" - now
-- just says "quiz". Nothing here touches the `weeks` table or any
-- column name; this is purely the text a player or host sees.
-- ============================================================

-- ---------- from 04_admin_functions.sql ----------

create or replace function admin_create_week(p_quiz_date date, p_title text, p_host_id uuid default null)
returns table(id uuid, quiz_date date, title text, host_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admins can create a quiz.';
  end if;

  if exists (select 1 from weeks w where w.quiz_date = p_quiz_date) then
    raise exception 'There is already a quiz on that date.';
  end if;

  insert into weeks (quiz_date, title, host_id)
  values (p_quiz_date, nullif(trim(coalesce(p_title, '')), ''), p_host_id)
  returning weeks.id into v_id;

  return query
    select w.id, w.quiz_date, w.title, w.host_id, w.status
    from weeks w where w.id = v_id;
end;
$$;

create or replace function admin_set_host(p_week_id uuid, p_host_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only admins can change the host.';
  end if;

  if not exists (select 1 from weeks where id = p_week_id) then
    raise exception 'That quiz was not found.';
  end if;

  update weeks set host_id = p_host_id where id = p_week_id;
end;
$$;

create or replace function admin_delete_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'Only admins can delete a quiz.';
  end if;

  select status into v_status from weeks where id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;

  if v_status = 'closed' then
    raise exception 'This quiz is closed and cannot be deleted.';
  end if;

  delete from weeks where id = p_week_id;
end;
$$;

-- ---------- from 05_poll_functions.sql ----------

create or replace function host_add_poll_option(p_week_id uuid, p_suggestion_id uuid)
returns table(id uuid, topic text)
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_topic  text;
  v_used   boolean;
  v_count  int;
  v_sort   int;
  v_id     uuid;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host of that week can build the ballot.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;
  if v_status not in ('draft', 'polling') then
    raise exception 'The ballot is closed for this quiz.';
  end if;

  select s.topic, s.used into v_topic, v_used from topic_suggestions s where s.id = p_suggestion_id;
  if not found then
    raise exception 'That suggestion was not found.';
  end if;
  if v_used then
    raise exception 'That topic is already on a ballot.';
  end if;

  select count(*) into v_count from poll_options o where o.week_id = p_week_id;
  if v_count >= 8 then
    raise exception 'The ballot is full. Eight topics is the most you can run at once.';
  end if;

  select coalesce(max(o.sort_order), -1) + 1 into v_sort from poll_options o where o.week_id = p_week_id;

  insert into poll_options (week_id, topic, sort_order, source_suggestion_id)
  values (p_week_id, v_topic, v_sort, p_suggestion_id)
  returning poll_options.id into v_id;

  update topic_suggestions set used = true where topic_suggestions.id = p_suggestion_id;

  return query select v_id, v_topic;
end;
$$;

create or replace function host_add_custom_option(p_week_id uuid, p_topic text)
returns table(id uuid, topic text)
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_topic  text := trim(p_topic);
  v_count  int;
  v_sort   int;
  v_id     uuid;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host of that week can build the ballot.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;
  if v_status not in ('draft', 'polling') then
    raise exception 'The ballot is closed for this quiz.';
  end if;

  if char_length(v_topic) < 3 or char_length(v_topic) > 120 then
    raise exception 'Topics need to be between 3 and 120 characters.';
  end if;

  select count(*) into v_count from poll_options o where o.week_id = p_week_id;
  if v_count >= 8 then
    raise exception 'The ballot is full. Eight topics is the most you can run at once.';
  end if;

  select coalesce(max(o.sort_order), -1) + 1 into v_sort from poll_options o where o.week_id = p_week_id;

  insert into poll_options (week_id, topic, sort_order)
  values (p_week_id, v_topic, v_sort)
  returning poll_options.id into v_id;

  return query select v_id, v_topic;
end;
$$;

create or replace function host_open_poll(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_count  int;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host of that week can open the poll.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;
  if v_status <> 'draft' then
    raise exception 'The poll can only be opened from the draft stage.';
  end if;

  select count(*) into v_count from poll_options o where o.week_id = p_week_id;
  if v_count < 2 then
    raise exception 'Add at least two topics to the ballot before opening the poll.';
  end if;

  update weeks set status = 'polling' where id = p_week_id;
end;
$$;

create or replace function cast_vote(p_week_id uuid, p_option_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := me();
  v_status text;
  v_host   uuid;
begin
  if v_me is null then
    raise exception 'Sign in to vote.';
  end if;

  select w.status, w.host_id into v_status, v_host from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;

  if v_status <> 'polling' then
    raise exception 'Voting is not open for this quiz.';
  end if;

  if v_host = v_me then
    raise exception 'The host sits this one out.';
  end if;

  if not exists (select 1 from poll_options o where o.id = p_option_id and o.week_id = p_week_id) then
    raise exception 'That topic is not on the ballot.';
  end if;

  insert into poll_votes (week_id, option_id, player_id)
  values (p_week_id, p_option_id, v_me)
  on conflict (week_id, player_id) do update set option_id = excluded.option_id;
end;
$$;

create or replace function host_close_poll(p_week_id uuid)
returns table(winning_topic text, tied boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_status    text;
  v_top_votes bigint;
  v_tie_count int;
  v_winner    text;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host of that week can close the poll.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;
  if v_status <> 'polling' then
    raise exception 'The poll is not open for this quiz.';
  end if;

  select max(r.votes) into v_top_votes from poll_results(p_week_id) r;
  if v_top_votes is null or v_top_votes = 0 then
    raise exception 'Nobody has voted yet.';
  end if;

  select count(*) into v_tie_count from poll_results(p_week_id) r where r.votes = v_top_votes;

  select r.topic into v_winner
  from poll_results(p_week_id) r
  where r.votes = v_top_votes
  order by random()
  limit 1;

  update weeks set topic = v_winner, status = 'building' where id = p_week_id;

  return query select v_winner, v_tie_count > 1;
end;
$$;

-- ---------- from 06_quiz_functions.sql ----------

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
    raise exception 'That quiz was not found.';
  end if;
  if v_status in ('live', 'closed') then
    raise exception 'Questions cannot be changed once the quiz is live.';
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
    raise exception 'Questions cannot be changed once the quiz is live.';
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
    raise exception 'That quiz was not found.';
  end if;
  if v_status in ('live', 'closed') then
    raise exception 'Questions cannot be changed once the quiz is live.';
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

-- ---------- from 07_live_functions.sql ----------

create or replace function start_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_count   int;
  v_missing int;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host can start the quiz.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;
  if v_status <> 'building' then
    raise exception 'This quiz is not ready to start.';
  end if;

  select count(*) into v_count from questions qq where qq.week_id = p_week_id;
  if v_count = 0 then
    raise exception 'Add at least one question before starting the quiz.';
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

-- ---------- from 08_final_submission.sql ----------

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
  if not found then raise exception 'That quiz was not found.'; end if;
  if v_status <> 'live' then raise exception 'This quiz is not live.'; end if;

  if v_host = v_me then
    raise exception 'The host does not play.';
  end if;

  insert into week_submissions (week_id, player_id) values (p_week_id, v_me)
  on conflict (week_id, player_id) do nothing;
end;
$$;

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
    raise exception 'This quiz is not live.';
  end if;

  delete from week_submissions where week_id = p_week_id and player_id = p_player_id;
end;
$$;

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
  media            jsonb
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
    raise exception 'That quiz was not found.';
  end if;

  select count(*) into v_total from questions qq where qq.week_id = p_week_id;
  v_submitted := exists (select 1 from week_submissions s where s.week_id = p_week_id and s.player_id = v_me);

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
             from question_media m where m.question_id = q.id), '[]'::jsonb)
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
                        null::numeric, null::text, null::text, null::text, null::text, null::numeric, null::jsonb;
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
           from question_media m where m.question_id = q.id), '[]'::jsonb)
    from questions q
    left join responses r on r.question_id = q.id and r.player_id = v_me
    where q.week_id = p_week_id and q.status = 'open'
    order by q.q_number;
end;
$$;

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
    raise exception 'That quiz was not found.';
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
