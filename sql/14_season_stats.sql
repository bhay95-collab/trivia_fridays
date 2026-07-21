-- ============================================================
-- TRIVIA FRIDAYS - SEASON STATS: BADGES, RECORDS, THE HOWLER
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: functions are replaced, tables use if-not-exists.
--
-- Everything here is read-only over data that is already public
-- (week_scores drives the leaderboard), except the howler vote,
-- which gets its own two tables. Votes are secret: counts are
-- public via howler_board(), who-voted-for-what is not.
-- ============================================================

-- ============================================================
-- THE HOWLER - worst free-text answer of the season.
-- The week's host nominates candidates from the answer review;
-- everyone gets one season vote they can move any time.
-- ============================================================
create table if not exists howler_nominations (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null unique references responses(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists howler_votes (
  player_id      uuid primary key references players(id) on delete cascade,
  nomination_id  uuid not null references howler_nominations(id) on delete cascade,
  created_at     timestamptz not null default now()
);

alter table howler_nominations enable row level security;
alter table howler_votes       enable row level security;

-- Nominations are public reading. All writes go through the
-- functions below - no insert/update/delete policies at all.
drop policy if exists howler_nom_read on howler_nominations;
create policy howler_nom_read on howler_nominations for select using (true);

-- You can see your own vote. Counts come from howler_board().
drop policy if exists howler_vote_read_own on howler_votes;
create policy howler_vote_read_own on howler_votes for select using (player_id = me());

-- Host (or admin) nominates a free-text answer from a closed week.
create or replace function nominate_howler(p_response_id uuid)
returns void
language plpgsql security definer set search_path = public as $nominate_howler$
declare
  v_week uuid;
  v_type text;
  v_status text;
begin
  select q.week_id, q.q_type, w.status into v_week, v_type, v_status
  from responses r
  join questions q on q.id = r.question_id
  join weeks w on w.id = q.week_id
  where r.id = p_response_id;

  if v_week is null then raise exception 'Answer not found.'; end if;
  if not is_host_of(v_week) then raise exception 'Only the host can nominate a howler.'; end if;
  if v_type <> 'text' then raise exception 'Only free-text answers can be howlers.'; end if;
  if v_status <> 'closed' then raise exception 'Wait until the quiz is closed.'; end if;

  insert into howler_nominations (response_id)
  values (p_response_id)
  on conflict (response_id) do nothing;
end;
$nominate_howler$;

create or replace function retract_howler(p_nomination_id uuid)
returns void
language plpgsql security definer set search_path = public as $retract_howler$
declare v_week uuid;
begin
  select q.week_id into v_week
  from howler_nominations n
  join responses r on r.id = n.response_id
  join questions q on q.id = r.question_id
  where n.id = p_nomination_id;

  if v_week is null then raise exception 'Nomination not found.'; end if;
  if not is_host_of(v_week) then raise exception 'Only the host can retract a nomination.'; end if;

  delete from howler_nominations where id = p_nomination_id;
end;
$retract_howler$;

-- One vote per player per season, movable any time.
create or replace function vote_howler(p_nomination_id uuid)
returns void
language plpgsql security definer set search_path = public as $vote_howler$
declare v_me uuid := me();
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from howler_nominations where id = p_nomination_id) then
    raise exception 'Nomination not found.';
  end if;

  insert into howler_votes (player_id, nomination_id)
  values (v_me, p_nomination_id)
  on conflict (player_id) do update
    set nomination_id = excluded.nomination_id, created_at = now();
end;
$vote_howler$;

-- The ballot: candidates, counts, and whether the caller's own
-- vote sits on each. Never exposes who else voted for what.
create or replace function howler_board()
returns table (
  nomination_id uuid,
  prompt        text,
  answer_raw    text,
  display_name  text,
  quiz_date     date,
  votes         bigint,
  mine          boolean
)
language sql stable security definer set search_path = public as $howler_board$
  select
    n.id,
    q.prompt,
    r.answer_raw,
    p.display_name,
    w.quiz_date,
    count(v.player_id),
    coalesce(bool_or(v.player_id = me()), false)
  from howler_nominations n
  join responses r on r.id = n.response_id
  join questions q on q.id = r.question_id
  join weeks w on w.id = q.week_id
  join players p on p.id = r.player_id
  left join howler_votes v on v.nomination_id = n.id
  group by n.id, q.prompt, r.answer_raw, p.display_name, w.quiz_date
  order by count(v.player_id) desc, min(n.created_at)
$howler_board$;

-- ============================================================
-- SEASON BADGES - deliberately generous: with a normal office
-- roster most people end the season holding at least one.
-- ============================================================
create or replace function season_badges()
returns table (
  player_id    uuid,
  display_name text,
  badge_code   text,
  badge_name   text,
  detail       text
)
language sql stable security definer set search_path = public as $season_badges$
with closed_weeks as (
  select id, quiz_date, topic,
         row_number() over (order by quiz_date) as week_no
  from weeks where status = 'closed'
),
scores as (
  select s.player_id, s.week_id, s.points, w.quiz_date, w.week_no
  from week_scores s
  join closed_weeks w on w.id = s.week_id
  where s.attended
),
week_max as (
  select q.week_id, sum(q.points) as max_points
  from questions q
  join closed_weeks w on w.id = q.week_id
  group by q.week_id
),
placed as (
  select scores.*,
         rank() over (partition by week_id order by points desc) as pos
  from scores
),
winners as (
  select * from placed where pos = 1
),
win_islands as (
  select player_id,
         count(*) as run_len
  from (
    select player_id, week_no,
           week_no - row_number() over (partition by player_id order by week_no) as grp
    from winners
  ) g
  group by player_id, grp
),
firsts as (
  select r.player_id, count(*) as n
  from responses r
  join (select question_id, min(created_at) as first_at
        from responses group by question_id) f
    on f.question_id = r.question_id and r.created_at = f.first_at
  join questions q on q.id = r.question_id
  join closed_weeks w on w.id = q.week_id
  group by r.player_id
),
jumps as (
  select player_id,
         points - lag(points) over (partition by player_id order by week_no) as jump
  from scores
),
halves as (
  select s.player_id,
         avg(s.points) filter (where s.week_no <= (select max(week_no) from closed_weeks) / 2) as first_half,
         avg(s.points) filter (where s.week_no >  (select max(week_no) from closed_weeks) / 2) as second_half,
         count(*) as played
  from scores s
  group by s.player_id
)

-- Perfect Night: full marks across a whole quiz.
select s.player_id, p.display_name, 'perfect', 'Perfect Night',
       count(*) || case when count(*) = 1 then ' flawless night' else ' flawless nights' end
from scores s
join week_max m on m.week_id = s.week_id and m.max_points > 0
join players p on p.id = s.player_id
where s.points >= m.max_points
group by s.player_id, p.display_name

union all
-- Ever-Present: never missed a Friday (once the season is real).
select s.player_id, p.display_name, 'ever_present', 'Never Missed a Friday',
       'All ' || count(*) || ' quizzes'
from scores s join players p on p.id = s.player_id
group by s.player_id, p.display_name
having count(*) = (select count(*) from closed_weeks)
   and count(*) >= 3

union all
-- Hot Streak: back-to-back wins.
select w.player_id, p.display_name, 'hot_streak', 'Hot Streak',
       'Won ' || max(w.run_len) || ' in a row'
from win_islands w join players p on p.id = w.player_id
where w.run_len >= 2
group by w.player_id, p.display_name

union all
-- Fast Finger: first answer in more often than anyone else.
select f.player_id, p.display_name, 'fast_finger', 'Fast Finger',
       'First to answer ' || f.n || ' times'
from firsts f join players p on p.id = f.player_id
where f.n >= 3
  and f.n = (select max(n) from firsts)

union all
-- Biggest Comeback: largest week-on-week jump of the season.
select j.player_id, p.display_name, 'comeback', 'Biggest Comeback',
       'Up ' || round(max(j.jump), 1) || ' points in a week'
from jumps j join players p on p.id = j.player_id
where j.jump is not null and j.jump > 0
group by j.player_id, p.display_name
having max(j.jump) = (select max(jump) from jumps where jump is not null)

union all
-- Most Improved: best second half of the season vs first half.
select h.player_id, p.display_name, 'most_improved', 'Most Improved',
       'Averaging +' || round(h.second_half - h.first_half, 1) || ' since mid-season'
from halves h join players p on p.id = h.player_id
where h.played >= 4
  and h.first_half is not null and h.second_half is not null
  and h.second_half > h.first_half
  and (h.second_half - h.first_half) = (
    select max(second_half - first_half) from halves
    where played >= 4 and first_half is not null and second_half is not null
  )

union all
-- Podium Regular: three or more top-three finishes.
select pl.player_id, p.display_name, 'podium_regular', 'Podium Regular',
       count(*) || ' podium finishes'
from placed pl join players p on p.id = pl.player_id
where pl.pos <= 3
group by pl.player_id, p.display_name
having count(*) >= 3

union all
-- Photo Finish: won a week by less than a point.
select w1.player_id, p.display_name, 'photo_finish', 'Photo Finish',
       'Won by ' || round(min(w1.points - p2.points), 2) || ' on ' || to_char(min(w1.quiz_date), 'DD Mon')
from winners w1
join placed p2 on p2.week_id = w1.week_id and p2.pos = 2
join players p on p.id = w1.player_id
where w1.points - p2.points > 0 and w1.points - p2.points < 1
group by w1.player_id, p.display_name

union all
-- Topic Titan: won the week their own suggested topic was used.
select distinct w.player_id, p.display_name, 'topic_titan', 'Topic Titan',
       'Won their own topic'
from winners w
join closed_weeks cw on cw.id = w.week_id
join topic_suggestions ts on ts.player_id = w.player_id
  and ts.used and ts.topic = cw.topic
join players p on p.id = w.player_id
$season_badges$;

-- ============================================================
-- SEASON RECORDS - the Halls of Fame and Shame.
-- Ties resolve alphabetically; one holder per record keeps the
-- wall readable.
-- ============================================================
create or replace function season_records()
returns table (
  record_code  text,
  record_name  text,
  display_name text,
  value        text,
  hall         text
)
language sql stable security definer set search_path = public as $season_records$
with closed_weeks as (
  select id, quiz_date,
         row_number() over (order by quiz_date) as week_no
  from weeks where status = 'closed'
),
scores as (
  select s.player_id, s.points, w.quiz_date, w.week_no
  from week_scores s
  join closed_weeks w on w.id = s.week_id
  where s.attended
),
placed as (
  select scores.*, p.display_name,
         rank() over (partition by week_no order by points desc) as pos
  from scores
  join players p on p.id = scores.player_id
),
win_islands as (
  select player_id, count(*) as run_len
  from (
    select player_id, week_no,
           week_no - row_number() over (partition by player_id order by week_no) as grp
    from placed where pos = 1
  ) g
  group by player_id, grp
),
halves as (
  select s.player_id, p.display_name,
         avg(s.points) filter (where s.week_no <= (select max(week_no) from closed_weeks) / 2) as first_half,
         avg(s.points) filter (where s.week_no >  (select max(week_no) from closed_weeks) / 2) as second_half,
         count(*) as played
  from scores s join players p on p.id = s.player_id
  group by s.player_id, p.display_name
)

(select 'highest_night', 'Highest single night', display_name,
        round(points, 1) || ' pts · ' || to_char(quiz_date, 'DD Mon'), 'fame'
 from placed order by points desc, display_name limit 1)

union all
(select 'longest_streak', 'Longest winning streak', p.display_name,
        max(w.run_len) || ' weeks', 'fame'
 from win_islands w join players p on p.id = w.player_id
 group by p.display_name
 order by max(w.run_len) desc, p.display_name limit 1)

union all
(select 'most_improved', 'Most improved', display_name,
        '+' || round(second_half - first_half, 1) || ' avg', 'fame'
 from halves
 where played >= 4 and first_half is not null and second_half is not null
   and second_half > first_half
 order by second_half - first_half desc, display_name limit 1)

union all
(select 'lowest_night', 'Lowest single night', display_name,
        round(points, 1) || ' pts · ' || to_char(quiz_date, 'DD Mon'), 'shame'
 from placed order by points asc, display_name limit 1)
$season_records$;

-- ============================================================
-- GRANTS - reads for anyone signed in; the write functions
-- carry their own checks but still are not for anonymous use.
-- ============================================================
grant execute on function season_badges()          to authenticated;
grant execute on function season_records()         to authenticated;
grant execute on function howler_board()           to authenticated;
grant execute on function nominate_howler(uuid)    to authenticated;
grant execute on function retract_howler(uuid)     to authenticated;
grant execute on function vote_howler(uuid)        to authenticated;

revoke execute on function season_badges()         from anon;
revoke execute on function season_records()        from anon;
revoke execute on function howler_board()          from anon;
revoke execute on function nominate_howler(uuid)   from anon;
revoke execute on function retract_howler(uuid)    from anon;
revoke execute on function vote_howler(uuid)       from anon;
