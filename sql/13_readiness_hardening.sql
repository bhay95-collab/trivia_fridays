-- ============================================================
-- TRIVIA FRIDAYS - READINESS HARDENING
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run. This patches existing projects without requiring
-- a rebuild from sql/01_schema.sql.
-- ============================================================

-- ============================================================
-- ACTIVE USERS ONLY
-- An inactive player may still have a browser session. These helpers
-- are the gate every RPC and policy uses, so inactive sessions stop
-- being players/admins/hosts immediately.
-- ============================================================
create or replace function me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from players where auth_id = auth.uid() and is_active
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from players where auth_id = auth.uid() and is_active), false)
$$;

create or replace function is_host_of(p_week uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from weeks w
    join players p on p.id = w.host_id
    where w.id = p_week and p.auth_id = auth.uid() and p.is_active
  ) or is_admin()
$$;

-- ============================================================
-- QUESTION MEDIA VISIBILITY AND URL-ONLY MVP
-- ============================================================
update question_media set source_type = 'url' where source_type <> 'url';

alter table question_media drop constraint if exists question_media_source_type_check;
alter table question_media add constraint question_media_source_type_check check (source_type = 'url');

alter table question_media drop constraint if exists question_media_url_check;
alter table question_media add constraint question_media_url_check check (url ~* '^https://') not valid;

alter table question_media enable row level security;

drop policy if exists qm_read_visible on question_media;
create policy qm_read_visible on question_media for select
  using (exists (
    select 1 from questions q
    where q.id = question_id and (q.status in ('open','locked') or is_host_of(q.week_id))
  ));

drop policy if exists qm_host on question_media;
create policy qm_host on question_media for all
  using (is_host_of((select week_id from questions where id = question_id)))
  with check (is_host_of((select week_id from questions where id = question_id)));

-- ============================================================
-- MEDIA-AWARE QUESTION SAVE
-- Drops the old no-media overload left by earlier setup files, then
-- keeps question media URL-only and HTTPS-only.
-- ============================================================
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

-- ============================================================
-- PLAYER LIVE STATE WITH MEDIA
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
