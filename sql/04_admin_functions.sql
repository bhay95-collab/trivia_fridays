-- ============================================================
-- TRIVIA FRIDAYS - ADMIN FUNCTIONS
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: every function below is "create or replace".
--
-- Every function here checks is_admin() itself. The admin page
-- calls these through supabase.rpc() - hiding a button in the
-- browser is not what keeps this safe, the database is.
-- ============================================================

-- ============================================================
-- SLUG GENERATION
-- "Emma O'Ryan" -> emma.oryan. Lower case, letters and spaces
-- only, spaces become dots. Appends .2, .3... if taken.
-- Dropped first: create or replace cannot rename a parameter, and
-- an older copy of this function may already exist with a
-- different parameter name.
-- ============================================================
drop function if exists make_slug(text);

create or replace function make_slug(p_display_name text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_base text;
  v_slug text;
  v_n    int := 1;
begin
  v_base := lower(trim(p_display_name));
  v_base := regexp_replace(v_base, '[^a-z ]', '', 'g');
  v_base := trim(v_base);
  v_base := regexp_replace(v_base, '\s+', '.', 'g');

  if v_base = '' then
    v_base := 'player';
  end if;

  v_slug := v_base;
  while exists (select 1 from players where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '.' || v_n;
  end loop;

  return v_slug;
end;
$$;

-- ============================================================
-- PEOPLE
-- ============================================================

-- Add a roster row. The slug is generated here, never typed by hand.
create or replace function admin_add_player(p_display_name text)
returns table(id uuid, slug text, display_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(p_display_name);
  v_slug text;
  v_id   uuid;
begin
  if not is_admin() then
    raise exception 'Only admins can add players.';
  end if;

  if char_length(v_name) < 2 then
    raise exception 'Enter a full name of at least two characters.';
  end if;

  if exists (select 1 from players p where lower(p.display_name) = lower(v_name)) then
    raise exception '% is already on the roster.', v_name;
  end if;

  v_slug := make_slug(v_name);

  insert into players (slug, display_name)
  values (v_slug, v_name)
  returning players.id into v_id;

  return query select v_id, v_slug, v_name;
exception
  when unique_violation then
    raise exception '% is already on the roster.', v_name;
end;
$$;

-- Clears their login so they can set a fresh PIN next visit.
-- Scores are untouched - nothing here touches responses or week_scores.
create or replace function admin_reset_pin(p_player_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_auth_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admins can reset a PIN.';
  end if;

  select auth_id into v_auth_id from players where id = p_player_id;
  if not found then
    raise exception 'That player was not found.';
  end if;

  if v_auth_id is null then
    raise exception 'No PIN is set for that player yet.';
  end if;

  update players set auth_id = null where id = p_player_id;
  delete from auth.users where id = v_auth_id;
end;
$$;

-- Soft delete for leavers. Their past scores stay on the board.
create or replace function admin_set_active(p_player_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only admins can change who is active.';
  end if;

  if not exists (select 1 from players where id = p_player_id) then
    raise exception 'That player was not found.';
  end if;

  if p_player_id = me() and not p_active then
    raise exception 'You cannot deactivate yourself.';
  end if;

  update players set is_active = p_active where id = p_player_id;
end;
$$;

-- Grant or remove admin rights.
create or replace function admin_set_admin(p_player_id uuid, p_is_admin boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_other_admins int;
begin
  if not is_admin() then
    raise exception 'Only admins can change admin rights.';
  end if;

  if not exists (select 1 from players where id = p_player_id) then
    raise exception 'That player was not found.';
  end if;

  if not p_is_admin then
    if p_player_id = me() then
      raise exception 'You cannot remove your own admin rights.';
    end if;

    select count(*) into v_other_admins
    from players
    where is_admin and is_active and id <> p_player_id;

    if v_other_admins = 0 then
      raise exception 'This is the last admin. Make someone else admin first.';
    end if;
  end if;

  update players set is_admin = p_is_admin where id = p_player_id;
end;
$$;

-- Everyone on the roster, with what the admin page needs to show.
-- Returns no rows at all to a non-admin.
create or replace function admin_roster()
returns table(
  id            uuid,
  slug          text,
  display_name  text,
  is_admin      boolean,
  is_active     boolean,
  pin_set       boolean,
  total_points  numeric,
  weeks_played  bigint
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.slug,
    p.display_name,
    p.is_admin,
    p.is_active,
    (p.auth_id is not null) as pin_set,
    coalesce(sum(s.points), 0)  as total_points,
    count(s.week_id)            as weeks_played
  from players p
  left join week_scores s on s.player_id = p.id and s.attended
  where is_admin()
  group by p.id, p.slug, p.display_name, p.is_admin, p.is_active, p.auth_id
  order by p.display_name
$$;

-- ============================================================
-- QUIZ NIGHTS
-- ============================================================

-- Create a night. One per calendar date.
create or replace function admin_create_week(p_quiz_date date, p_title text, p_host_id uuid default null)
returns table(id uuid, quiz_date date, title text, host_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admins can create a quiz night.';
  end if;

  if exists (select 1 from weeks w where w.quiz_date = p_quiz_date) then
    raise exception 'There is already a quiz night on that date.';
  end if;

  insert into weeks (quiz_date, title, host_id)
  values (p_quiz_date, nullif(trim(coalesce(p_title, '')), ''), p_host_id)
  returning weeks.id into v_id;

  return query
    select w.id, w.quiz_date, w.title, w.host_id, w.status
    from weeks w where w.id = v_id;
end;
$$;

-- Change who is hosting a night.
create or replace function admin_set_host(p_week_id uuid, p_host_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only admins can change the host.';
  end if;

  if not exists (select 1 from weeks where id = p_week_id) then
    raise exception 'That quiz night was not found.';
  end if;

  update weeks set host_id = p_host_id where id = p_week_id;
end;
$$;

-- Remove a night that was created by mistake. Closed nights are final.
create or replace function admin_delete_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'Only admins can delete a quiz night.';
  end if;

  select status into v_status from weeks where id = p_week_id;
  if not found then
    raise exception 'That quiz night was not found.';
  end if;

  if v_status = 'closed' then
    raise exception 'This night is closed and cannot be deleted.';
  end if;

  delete from weeks where id = p_week_id;
end;
$$;

-- Every night with its host's name attached, for the admin table.
-- Weeks and players are both public reads already, so this is open
-- to anyone signed in - it does not expose anything RLS would not.
create or replace function weeks_with_hosts()
returns table(
  id         uuid,
  quiz_date  date,
  title      text,
  status     text,
  host_id    uuid,
  host_name  text
)
language sql stable security definer set search_path = public as $$
  select w.id, w.quiz_date, w.title, w.status, w.host_id, h.display_name as host_name
  from weeks w
  left join players h on h.id = w.host_id
  order by w.quiz_date desc
$$;
