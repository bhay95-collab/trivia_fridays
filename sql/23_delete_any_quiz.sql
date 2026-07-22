-- ============================================================
-- TRIVIA FRIDAYS - LET ADMINS DELETE CLOSED QUIZZES TOO
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run.
--
-- admin_delete_week used to refuse to delete a quiz once it was
-- closed, so a test/mistake quiz that got all the way to closed
-- was stuck forever. The FK graph from `weeks` was already built
-- with `on delete cascade` everywhere (questions, answer_keys,
-- question_media, responses, week_scores, week_submissions,
-- poll_options/votes, question_jokers, howler_nominations/votes),
-- and the leaderboard/streak/season views all compute live off of
-- whatever weeks remain - so dropping the status check is enough
-- to fully clean up a quiz without leaving any other quiz's score
-- or streak affected.
-- ============================================================

create or replace function admin_delete_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Only admins can delete a quiz.';
  end if;

  if not exists (select 1 from weeks where id = p_week_id) then
    raise exception 'That quiz was not found.';
  end if;

  delete from weeks where id = p_week_id;
end;
$$;
