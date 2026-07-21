-- ============================================================
-- TRIVIA FRIDAYS - FULL DATABASE SCHEMA
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: it drops and rebuilds everything.
-- ============================================================

-- Extensions used for typo-tolerant answer matching
create extension if not exists fuzzystrmatch;   -- levenshtein()
create extension if not exists pg_trgm;         -- similarity()

-- ---------- clean slate ----------
drop view   if exists leaderboard cascade;
drop table  if exists week_scores      cascade;
drop table  if exists responses        cascade;
drop table  if exists answer_keys      cascade;
drop table  if exists questions        cascade;
drop table  if exists poll_votes       cascade;
drop table  if exists poll_options     cascade;
drop table  if exists topic_suggestions cascade;
drop table  if exists weeks            cascade;
drop table  if exists players          cascade;
drop function if exists handle_new_user() cascade;

-- ============================================================
-- PLAYERS
-- slug is the login handle. Login email is <slug>@triviafridays.local
-- Rows are seeded by the admin. Nobody can create their own row.
-- ============================================================
create table players (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid unique references auth.users(id) on delete set null,
  slug        text unique not null,
  display_name text not null,
  is_admin    boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- WEEKS
-- status flow: draft -> polling -> building -> live -> closed
-- ============================================================
create table weeks (
  id           uuid primary key default gen_random_uuid(),
  quiz_date    date not null unique,
  title        text,
  topic        text,
  host_id      uuid references players(id) on delete set null,
  status       text not null default 'draft'
                 check (status in ('draft','polling','building','live','closed')),
  created_at   timestamptz not null default now()
);

-- ============================================================
-- TOPIC SUGGESTIONS (anyone can drop an idea in the pool)
-- ============================================================
create table topic_suggestions (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references players(id) on delete cascade,
  topic        text not null check (char_length(topic) between 2 and 120),
  used         boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- POLL (host promotes suggestions into a weekly poll)
-- ============================================================
create table poll_options (
  id           uuid primary key default gen_random_uuid(),
  week_id      uuid not null references weeks(id) on delete cascade,
  topic        text not null,
  sort_order   int  not null default 0
);

create table poll_votes (
  id           uuid primary key default gen_random_uuid(),
  week_id      uuid not null references weeks(id) on delete cascade,
  option_id    uuid not null references poll_options(id) on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (week_id, player_id)          -- one vote per player per week
);

-- ============================================================
-- QUESTIONS
-- No timer. Host opens and locks each question manually.
-- status: pending -> open -> locked
-- options: JSON array for multiple choice, e.g.
--   [{"key":"A","text":"Paris"},{"key":"B","text":"Rome"}]
-- ============================================================
create table questions (
  id           uuid primary key default gen_random_uuid(),
  week_id      uuid not null references weeks(id) on delete cascade,
  q_number     int  not null,
  q_type       text not null check (q_type in ('mc','text')),
  prompt       text not null,
  options      jsonb,
  points       numeric(5,2) not null default 1 check (points > 0),
  status       text not null default 'pending'
                 check (status in ('pending','open','locked')),
  opened_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (week_id, q_number)
);

-- ============================================================
-- ANSWER KEYS  *** LOCKED TABLE ***
-- Players have NO read policy here. Only the host of that week
-- and admins can see it. Grading happens server-side.
-- ============================================================
create table answer_keys (
  question_id  uuid primary key references questions(id) on delete cascade,
  correct_key  text,        -- for 'mc': the option key, e.g. "B"
  correct_text text,        -- for 'text': the main accepted answer
  alternates   text[] not null default '{}'  -- e.g. {'JFK','John F Kennedy'}
);

-- ============================================================
-- RESPONSES
-- Written only by submit_answer(). One per player per question.
-- ============================================================
create table responses (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references questions(id) on delete cascade,
  player_id      uuid not null references players(id) on delete cascade,
  answer_raw     text not null,
  verdict        text not null check (verdict in ('correct','partial','wrong')),
  points_awarded numeric(5,2) not null default 0,
  overridden     boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (question_id, player_id)
);

-- ============================================================
-- WEEK SCORES (final total per player per week; drives leaderboard)
-- ============================================================
create table week_scores (
  week_id    uuid not null references weeks(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  points     numeric(6,2) not null default 0,
  attended   boolean not null default true,
  primary key (week_id, player_id)
);

-- ============================================================
-- HELPERS
-- ============================================================

-- Current player's row id, derived from the logged-in auth user.
create or replace function me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from players where auth_id = auth.uid()
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from players where auth_id = auth.uid()), false)
$$;

create or replace function is_host_of(p_week uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from weeks w
    join players p on p.id = w.host_id
    where w.id = p_week and p.auth_id = auth.uid()
  ) or is_admin()
$$;

-- Strip case, punctuation and a leading "the/a/an", squash spaces.
create or replace function norm_answer(t text) returns text
language sql immutable as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(t, '')), '[^a-z0-9 ]', '', 'g'),
      '^(the|a|an) ', ''),
    '\s+', ' ', 'g')
  )
$$;

-- ============================================================
-- SIGN-UP GUARD
-- A new auth user is only allowed if their email matches an
-- unclaimed roster slug. Otherwise sign-up fails outright.
-- ============================================================
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_slug text;
  v_id   uuid;
begin
  v_slug := split_part(new.email, '@', 1);

  select id into v_id
  from players
  where slug = v_slug and auth_id is null and is_active;

  if v_id is null then
    raise exception 'That name is not on the roster, or a PIN was already set for it.';
  end if;

  update players set auth_id = new.id where id = v_id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- GRADING
-- ============================================================
create or replace function submit_answer(p_question_id uuid, p_answer text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  q            questions%rowtype;
  k            answer_keys%rowtype;
  v_me         uuid := me();
  v_given      text;
  v_target     text;
  v_best       int := 999;
  v_dist       int;
  v_verdict    text := 'wrong';
  v_points     numeric(5,2) := 0;
  v_all        text[];
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  select * into q from questions where id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;
  if q.status <> 'open' then raise exception 'That question is not open.'; end if;

  select * into k from answer_keys where question_id = p_question_id;
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

  insert into responses (question_id, player_id, answer_raw, verdict, points_awarded)
  values (p_question_id, v_me, p_answer, v_verdict, v_points);

  return 'submitted';   -- deliberately tells the player nothing about the result
exception
  when unique_violation then
    raise exception 'You already answered that one.';
end;
$$;

-- Host flips a wrong answer to right (or back again). Points recalculated.
create or replace function override_response(p_response_id uuid, p_verdict text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week uuid;
  v_pts  numeric(5,2);
begin
  select q.week_id, q.points into v_week, v_pts
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
end;
$$;

-- Host opens / locks a question.
create or replace function set_question_status(p_question_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_week uuid;
begin
  select week_id into v_week from questions where id = p_question_id;
  if not is_host_of(v_week) then raise exception 'Only the host can do that.'; end if;

  update questions
  set status = p_status,
      opened_at = case when p_status = 'open' then now() else opened_at end
  where id = p_question_id;
end;
$$;

-- Host finalises the night: totals go into week_scores.
create or replace function close_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_host_of(p_week_id) then raise exception 'Only the host can close the week.'; end if;

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

-- Live poll tally (safe to expose - it hides who voted for what).
create or replace function poll_results(p_week_id uuid)
returns table (option_id uuid, topic text, votes bigint)
language sql stable security definer set search_path = public as $$
  select o.id, o.topic, count(v.id)
  from poll_options o
  left join poll_votes v on v.option_id = o.id
  where o.week_id = p_week_id
  group by o.id, o.topic
  order by count(v.id) desc, o.sort_order
$$;

-- ============================================================
-- LEADERBOARD (total points, per your ranking rule)
-- ============================================================
create or replace view leaderboard as
select
  p.id                              as player_id,
  p.display_name,
  coalesce(sum(s.points), 0)        as total_points,
  count(s.week_id)                  as weeks_played,
  coalesce(max(s.points), 0)        as best_week,
  case when count(s.week_id) = 0 then 0
       else round(coalesce(sum(s.points),0) / count(s.week_id), 2) end as avg_points
from players p
left join week_scores s on s.player_id = p.id and s.attended
where p.is_active
group by p.id, p.display_name;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table players           enable row level security;
alter table weeks             enable row level security;
alter table topic_suggestions enable row level security;
alter table poll_options      enable row level security;
alter table poll_votes        enable row level security;
alter table questions         enable row level security;
alter table answer_keys       enable row level security;
alter table responses         enable row level security;
alter table week_scores       enable row level security;

-- Roster: anyone (even signed out) can see names, so the login
-- dropdown works. No PINs or emails live here.
create policy players_read   on players for select using (true);
create policy players_admin  on players for all    using (is_admin()) with check (is_admin());

-- Weeks: everyone reads. Admin creates. Host edits their own week.
create policy weeks_read     on weeks for select using (true);
create policy weeks_admin    on weeks for all    using (is_admin()) with check (is_admin());
create policy weeks_host     on weeks for update using (host_id = me());

-- Suggestions: everyone reads, signed-in players add their own.
create policy sugg_read      on topic_suggestions for select using (true);
create policy sugg_insert    on topic_suggestions for insert with check (player_id = me());
create policy sugg_delete    on topic_suggestions for delete using (player_id = me() or is_admin());

-- Poll: everyone reads options. Host builds them. Players vote once.
create policy poll_opt_read  on poll_options for select using (true);
create policy poll_opt_host  on poll_options for all
  using (is_host_of(week_id)) with check (is_host_of(week_id));
create policy poll_vote_ins  on poll_votes for insert with check (player_id = me());
create policy poll_vote_read on poll_votes for select using (player_id = me() or is_host_of(week_id));

-- Questions: players only ever see a question once the host opens it.
-- The host sees all of their own week's questions while building.
create policy q_read_open on questions for select
  using (status in ('open','locked') or is_host_of(week_id));
create policy q_host      on questions for all
  using (is_host_of(week_id)) with check (is_host_of(week_id));

-- Answer keys: no player policy at all. Host and admin only.
create policy ak_host on answer_keys for all
  using (is_host_of((select week_id from questions where id = question_id)))
  with check (is_host_of((select week_id from questions where id = question_id)));

-- Responses: you see your own. Host sees the whole room.
-- Nobody INSERTs directly - submit_answer() does it.
create policy resp_read on responses for select
  using (player_id = me()
         or is_host_of((select week_id from questions where id = question_id)));

-- Week scores: public. This is the leaderboard.
create policy ws_read  on week_scores for select using (true);
create policy ws_admin on week_scores for all using (is_admin()) with check (is_admin());

-- Let the browser read the leaderboard view
grant select on leaderboard to anon, authenticated;
