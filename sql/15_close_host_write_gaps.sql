-- ============================================================
-- TRIVIA FRIDAYS - CLOSE HOST DIRECT-WRITE RLS GAPS
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: policies are dropped with IF EXISTS, nothing
-- destructive happens to any data.
--
-- SECURITY REVIEW FINDING (HIGH):
-- weeks_host / q_host / ak_host / qm_host granted "for update" or
-- "for all" access keyed only on ownership (host_id = me() /
-- is_host_of(week_id)), with no check on the underlying quiz's
-- status. That let a host bypass the state-machine and validation
-- logic that only lives in the RPC layer - for example:
--
--   * PATCH weeks?id=eq.<id> {"status":"closed"} directly via the
--     REST API skips close_week() entirely, so week_scores never
--     gets computed for that week - a silent, permanent gap in the
--     season leaderboard.
--   * PATCH weeks?id=eq.<id> {"status":"live"} skips start_week()'s
--     check that every question has a complete answer key.
--   * PATCH questions?id=eq.<id> can edit a prompt/points/options
--     after the quiz is live or closed, bypassing
--     host_save_question()'s "cannot be changed once live" rule.
--
-- No client code in this app ever writes to these four tables
-- directly - every mutation already goes through start_week(),
-- close_week(), host_open_poll(), host_close_poll(),
-- host_save_question(), host_delete_question(), and
-- host_reorder_questions(). Those functions are all
-- SECURITY DEFINER, so they run as the function owner and are
-- unaffected by RLS - exactly the same reason submit_answer()
-- already works today even though the responses table has no
-- insert policy at all ("Nobody INSERTs directly").
--
-- Dropping these four policies only closes the REST-API bypass
-- path. Nothing in the app's behaviour changes. Admins are
-- unaffected (weeks_admin already grants full access via
-- is_admin()), and every read policy (weeks_read, q_read_open,
-- qm_read_visible) is untouched.
-- ============================================================

drop policy if exists weeks_host on weeks;
drop policy if exists q_host     on questions;
drop policy if exists ak_host    on answer_keys;
drop policy if exists qm_host    on question_media;
