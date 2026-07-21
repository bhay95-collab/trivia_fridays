-- ============================================================
-- TRIVIA FRIDAYS - TOPIC SUGGESTIONS + WEEKLY POLL
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: functions are "create or replace", the schema
-- tweak below uses "if not exists", and the RLS policy is dropped
-- and recreated.
--
-- Every privileged action here checks who is calling itself -
-- suggest_topic checks you are signed in, the host_* functions
-- check is_host_of(), cast_vote checks the week is open and that
-- you are not the host. Hiding a button is not what stops any of
-- this, the database is.
-- ============================================================

-- ============================================================
-- SCHEMA EXTENSION
-- We need to know which suggestion (if any) a ballot option came
-- from, so removing it from the ballot can free the suggestion up
-- again. This does not change anything that already exists.
-- ============================================================
alter table poll_options
  add column if not exists source_suggestion_id uuid references topic_suggestions(id) on delete set null;

-- ============================================================
-- VOTING PRIVACY
-- The old policy let a week's host read every row in poll_votes,
-- which links a person to the option they picked. Nobody should
-- be able to do that by any route - the tally goes through
-- poll_results() only, which hides who voted for what. Tighten
-- this so a player can only ever see their own vote.
-- ============================================================
drop policy if exists poll_vote_read on poll_votes;
create policy poll_vote_read on poll_votes for select using (player_id = me());

-- ============================================================
-- SUGGESTIONS
-- ============================================================

-- Drop a topic idea into the shared pool. Signed-in players only.
create or replace function suggest_topic(p_topic text)
returns table(id uuid, topic text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := me();
  v_topic text := trim(p_topic);
  v_id    uuid;
begin
  if v_me is null then
    raise exception 'Sign in to suggest a topic.';
  end if;

  if char_length(v_topic) < 3 or char_length(v_topic) > 120 then
    raise exception 'Topics need to be between 3 and 120 characters.';
  end if;

  if exists (
    select 1 from topic_suggestions s
    where s.player_id = v_me and lower(s.topic) = lower(v_topic)
  ) then
    raise exception 'You already suggested that one.';
  end if;

  insert into topic_suggestions (player_id, topic)
  values (v_me, v_topic)
  returning topic_suggestions.id into v_id;

  return query select t.id, t.topic, t.created_at from topic_suggestions t where t.id = v_id;
end;
$$;

-- Remove a suggestion. The person who made it, or an admin.
create or replace function delete_suggestion(p_suggestion_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  select s.player_id into v_owner from topic_suggestions s where s.id = p_suggestion_id;
  if not found then
    raise exception 'That suggestion was not found.';
  end if;

  if v_owner <> me() and not is_admin() then
    raise exception 'You can only remove your own suggestions.';
  end if;

  delete from topic_suggestions where id = p_suggestion_id;
end;
$$;

-- ============================================================
-- BALLOT BUILDING (host of the week, or an admin)
-- ============================================================

-- Copy a suggestion onto the ballot and mark it used.
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
    raise exception 'That quiz night was not found.';
  end if;
  if v_status not in ('draft', 'polling') then
    raise exception 'The ballot is closed for this night.';
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

-- Put a topic on the ballot that nobody suggested.
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
    raise exception 'That quiz night was not found.';
  end if;
  if v_status not in ('draft', 'polling') then
    raise exception 'The ballot is closed for this night.';
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

-- Take a topic off the ballot. Frees the source suggestion up again.
create or replace function host_remove_poll_option(p_option_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week_id       uuid;
  v_suggestion_id uuid;
begin
  select o.week_id, o.source_suggestion_id into v_week_id, v_suggestion_id
  from poll_options o where o.id = p_option_id;

  if not found then
    raise exception 'That ballot option was not found.';
  end if;

  if not is_host_of(v_week_id) then
    raise exception 'Only the host of that week can edit the ballot.';
  end if;

  delete from poll_options where id = p_option_id;

  if v_suggestion_id is not null then
    update topic_suggestions set used = false where id = v_suggestion_id;
  end if;
end;
$$;

-- ============================================================
-- RUNNING THE POLL
-- ============================================================

-- Open voting. Needs at least two options on the ballot.
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
    raise exception 'That quiz night was not found.';
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

-- Anyone signed in except the host of that week, one vote each.
-- Voting again before the poll closes changes the vote.
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
    raise exception 'That quiz night was not found.';
  end if;

  if v_status <> 'polling' then
    raise exception 'Voting is not open for this night.';
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

-- The option this player picked for that week, or null.
create or replace function my_vote(p_week_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select option_id from poll_votes where week_id = p_week_id and player_id = me()
$$;

-- Tally the votes, crown a winner, move the week to building.
-- Ties are broken at random and the return value says so.
create or replace function poll_results(p_week_id uuid)
returns table(option_id uuid, topic text, votes bigint)
language sql stable security definer set search_path = public as $$
  select
    o.id as option_id,
    o.topic,
    count(v.id) as votes
  from poll_options o
  left join poll_votes v on v.option_id = o.id and v.week_id = p_week_id
  where o.week_id = p_week_id
  group by o.id, o.topic
  order by o.sort_order, o.topic
$$;

create or replace function my_vote(p_week_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select option_id from poll_votes where week_id = p_week_id and player_id = me()
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
    raise exception 'That quiz night was not found.';
  end if;
  if v_status <> 'polling' then
    raise exception 'The poll is not open for this night.';
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
