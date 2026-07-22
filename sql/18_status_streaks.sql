-- ============================================================
-- TRIVIA FRIDAYS - ATTENDANCE STREAKS
-- Paste this whole file into Supabase > SQL Editor > Run.
-- Safe to re-run: it is a single "create or replace function".
--
-- Rewards simply showing up. For each active player it returns:
--   current_streak - consecutive most-recent closed weeks attended
--                    (0 the moment they miss the latest one)
--   best_streak    - their longest run of consecutive weeks attended
-- Derived entirely from week_scores.attended, which is already public
-- (the leaderboard reads it), so this is granted to anon too and adds
-- no new data or tables. A classic gaps-and-islands count.
-- ============================================================
create or replace function attendance_streaks()
returns table(player_id uuid, current_streak int, best_streak int)
language sql stable security definer set search_path = public as $$
  with closed as (
    select id, row_number() over (order by quiz_date) as wk
    from weeks where status = 'closed'
  ),
  maxwk as (select coalesce(max(wk), 0) as m from closed),
  grid as (
    -- one row per active player per closed week: did they attend it?
    select p.id as player_id, c.wk,
           case when exists (
             select 1 from week_scores s
             where s.week_id = c.id and s.player_id = p.id and s.attended
           ) then 1 else 0 end as present
    from players p
    cross join closed c
    where p.is_active
  ),
  islands as (
    -- consecutive weeks with the same present-value share a group key
    select player_id, wk, present,
           wk - row_number() over (partition by player_id, present order by wk) as grp
    from grid
  ),
  runs as (
    select player_id, present, count(*) as len, max(wk) as last_wk
    from islands
    group by player_id, present, grp
  )
  select
    g.player_id,
    coalesce((
      select r.len from runs r, maxwk
      where r.player_id = g.player_id and r.present = 1 and r.last_wk = maxwk.m
    ), 0) as current_streak,
    coalesce((
      select max(r.len) from runs r
      where r.player_id = g.player_id and r.present = 1
    ), 0) as best_streak
  from (select distinct player_id from grid) g
$$;

grant execute on function attendance_streaks() to anon, authenticated;
