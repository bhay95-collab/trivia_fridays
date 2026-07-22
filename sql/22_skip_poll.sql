-- ============================================================
-- TRIVIA FRIDAYS - SKIP THE POLL
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run.
--
-- A quiz only ever reached "building" (the status Present looks for
-- to show the "ready to start" panel - see present.js findWeeks())
-- by running a ballot: open the poll, get a vote, close the poll.
-- Some weeks don't need a ballot at all - the host already knows the
-- topic, or there isn't one. This adds a way to jump straight from
-- draft (or an abandoned polling attempt) to building without a
-- vote. Nothing else changes: start_week() still requires at least
-- one saved question before the quiz can actually go live, exactly
-- as it does for a quiz that came out of a real poll.
-- ============================================================

create or replace function host_skip_poll(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not is_host_of(p_week_id) then
    raise exception 'Only the host of that week can skip the poll.';
  end if;

  select w.status into v_status from weeks w where w.id = p_week_id;
  if not found then
    raise exception 'That quiz was not found.';
  end if;
  if v_status not in ('draft', 'polling') then
    raise exception 'The poll can only be skipped before the quiz is built.';
  end if;

  update weeks set status = 'building' where id = p_week_id;
end;
$$;

grant execute on function host_skip_poll(uuid) to authenticated;
revoke execute on function host_skip_poll(uuid) from anon;
