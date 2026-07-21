-- ============================================================
-- TRIVIA FRIDAYS - GATE QUESTIONS BEHIND "LIVE"
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run: "create or replace" with the same signature
-- set_question_status() already had.
--
-- set_question_status() checked who was calling it, but never
-- checked the week's own status - a host could call it straight
-- from the browser console and open a question (making it visible
-- and answerable) before start_week() had ever been run. The
-- Present page never exposed a way to do this, but hiding a button
-- is not what is supposed to stop it here - the database is. This
-- closes that gap: a question can only move to 'open' while its
-- week is 'live'.
-- ============================================================
create or replace function set_question_status(p_question_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week        uuid;
  v_week_status text;
begin
  select week_id into v_week from questions where id = p_question_id;
  if not is_host_of(v_week) then raise exception 'Only the host can do that.'; end if;

  if p_status = 'open' then
    select status into v_week_status from weeks where id = v_week;
    if v_week_status <> 'live' then
      raise exception 'The quiz is not live yet.';
    end if;
  end if;

  update questions
  set status = p_status,
      opened_at = case when p_status = 'open' then now() else opened_at end
  where id = p_question_id;
end;
$$;
