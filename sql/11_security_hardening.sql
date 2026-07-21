-- ============================================================
-- TRIVIA FRIDAYS - CLOSE TWO GAPS FOUND BY THE SUPABASE LINTER
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: the revokes are no-ops if already revoked, and
-- the function is "create or replace" with the same signature.
-- ============================================================

-- ============================================================
-- grade_response() WAS STILL DIRECTLY CALLABLE
-- sql/06_quiz_functions.sql revoked EXECUTE from the "public"
-- pseudo-role, but Supabase separately grants EXECUTE on every new
-- function in the public schema to the anon and authenticated
-- roles by default - that grant was never revoked. grade_response()
-- does no permission or "is the question open" checks of its own
-- (submit_answer() and test_answer() are supposed to be the only
-- way in), so left reachable directly it lets anyone brute-force a
-- multiple choice answer by trying every key and watching for
-- 'correct'. This closes that off properly.
-- ============================================================
revoke execute on function grade_response(uuid, text) from public;
revoke execute on function grade_response(uuid, text) from anon;
revoke execute on function grade_response(uuid, text) from authenticated;

-- ============================================================
-- norm_answer() HAD NO FIXED search_path
-- Not security definer, so this was low risk, but leaving
-- search_path unset lets it be pointed at a different schema than
-- intended. Pin it down.
-- ============================================================
create or replace function norm_answer(t text) returns text
language sql immutable set search_path = public as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(t, '')), '[^a-z0-9 ]', '', 'g'),
      '^(the|a|an) ', ''),
    '\s+', ' ', 'g')
  )
$$;
