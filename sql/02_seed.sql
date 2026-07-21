-- ============================================================
-- TRIVIA FRIDAYS - SEED DATA (roster + 4 historical weeks)
-- Run AFTER 01_schema.sql
-- ============================================================

-- ---------- ROSTER ----------
insert into players (slug, display_name, is_admin) values
  ('amelia.oreilly', 'Amelia O''Reilly', false),
  ('anika.van.der.velde', 'Anika Van Der Velde', false),
  ('benjamin.hay', 'Benjamin Hay', true),
  ('brittany.lamb', 'Brittany Lamb', false),
  ('cortney.neilson', 'Cortney Neilson', false),
  ('courtney.prince', 'Courtney Prince', false),
  ('doug.hendry', 'Doug Hendry', false),
  ('emma.anderson', 'Emma Anderson', false),
  ('emma.oryan', 'Emma O''Ryan', false),
  ('georgina.best', 'Georgina Best', false),
  ('grace.carson', 'Grace Carson', false),
  ('hannah.ferris', 'Hannah Ferris', false),
  ('jessica.ellis', 'Jessica Ellis', false),
  ('kellee.ralph', 'Kellee Ralph', false),
  ('lee.nolan', 'Lee Nolan', false),
  ('lindsay.parkes', 'Lindsay Parkes', false),
  ('machaela.stanton', 'Machaela Stanton', false),
  ('marian.gough', 'Marian Gough', false),
  ('michael.vo', 'Michael Vo', false),
  ('shaun.clark', 'Shaun Clark', false),
  ('my.darling.wife', 'My Darling Wife', false)
on conflict (slug) do nothing;

-- ---------- HISTORICAL WEEKS ----------
insert into weeks (quiz_date, title, status) values
  ('2026-06-26', 'Week 1', 'closed'),
  ('2026-07-03', 'Week 2', 'closed'),
  ('2026-07-09', 'Week 3', 'closed'),
  ('2026-07-16', 'Week 4', 'closed')
on conflict (quiz_date) do nothing;

-- ---------- HISTORICAL SCORES ----------
-- 'FTA'/'FA'/blank in the old sheet = did not attend, so no row is written.
insert into week_scores (week_id, player_id, points, attended)
select w.id, p.id, v.pts, true
from (values
  ('2026-07-09'::date, 'amelia.oreilly', 11),
  ('2026-07-16'::date, 'amelia.oreilly', 9),
  ('2026-07-09'::date, 'anika.van.der.velde', 8),
  ('2026-07-16'::date, 'anika.van.der.velde', 10.5),
  ('2026-06-26'::date, 'benjamin.hay', 13),
  ('2026-07-03'::date, 'benjamin.hay', 14),
  ('2026-07-09'::date, 'benjamin.hay', 14),
  ('2026-07-16'::date, 'benjamin.hay', 13),
  ('2026-06-26'::date, 'brittany.lamb', 10),
  ('2026-07-09'::date, 'brittany.lamb', 5),
  ('2026-07-03'::date, 'cortney.neilson', 5),
  ('2026-07-09'::date, 'cortney.neilson', 4),
  ('2026-07-16'::date, 'cortney.neilson', 10),
  ('2026-06-26'::date, 'courtney.prince', 12),
  ('2026-07-03'::date, 'courtney.prince', 9),
  ('2026-07-09'::date, 'courtney.prince', 5),
  ('2026-07-16'::date, 'courtney.prince', 11.5),
  ('2026-07-09'::date, 'doug.hendry', 5),
  ('2026-06-26'::date, 'emma.anderson', 9),
  ('2026-07-03'::date, 'emma.anderson', 6),
  ('2026-07-16'::date, 'emma.anderson', 10),
  ('2026-06-26'::date, 'emma.oryan', 13),
  ('2026-07-03'::date, 'emma.oryan', 6),
  ('2026-07-03'::date, 'georgina.best', 11),
  ('2026-07-09'::date, 'georgina.best', 12),
  ('2026-07-09'::date, 'grace.carson', 5),
  ('2026-07-16'::date, 'grace.carson', 10),
  ('2026-06-26'::date, 'hannah.ferris', 3),
  ('2026-07-03'::date, 'hannah.ferris', 10),
  ('2026-06-26'::date, 'jessica.ellis', 7),
  ('2026-07-03'::date, 'jessica.ellis', 8),
  ('2026-07-09'::date, 'jessica.ellis', 11),
  ('2026-07-16'::date, 'jessica.ellis', 11),
  ('2026-06-26'::date, 'kellee.ralph', 14),
  ('2026-07-03'::date, 'kellee.ralph', 4),
  ('2026-07-16'::date, 'kellee.ralph', 8),
  ('2026-06-26'::date, 'lee.nolan', 4),
  ('2026-07-03'::date, 'lee.nolan', 6),
  ('2026-07-16'::date, 'lee.nolan', 8),
  ('2026-06-26'::date, 'lindsay.parkes', 10),
  ('2026-07-09'::date, 'lindsay.parkes', 10),
  ('2026-07-16'::date, 'lindsay.parkes', 9),
  ('2026-06-26'::date, 'machaela.stanton', 8),
  ('2026-07-03'::date, 'machaela.stanton', 9),
  ('2026-07-09'::date, 'machaela.stanton', 7),
  ('2026-07-16'::date, 'machaela.stanton', 6),
  ('2026-07-16'::date, 'marian.gough', 8),
  ('2026-07-03'::date, 'michael.vo', 14),
  ('2026-07-09'::date, 'michael.vo', 9),
  ('2026-06-26'::date, 'shaun.clark', 11),
  ('2026-07-03'::date, 'shaun.clark', 9),
  ('2026-07-09'::date, 'shaun.clark', 12),
  ('2026-07-16'::date, 'shaun.clark', 12.5),
  ('2026-06-26'::date, 'my.darling.wife', 14),
  ('2026-07-03'::date, 'my.darling.wife', 5)
) as v(qdate, slug, pts)
join weeks w   on w.quiz_date = v.qdate
join players p on p.slug = v.slug
on conflict (week_id, player_id) do update set points = excluded.points;
