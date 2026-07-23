-- ============================================================
-- TRIVIA FRIDAYS - CLEAN UP STORAGE ON QUIZ DELETE
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run.
--
-- admin_delete_week (sql/23_delete_any_quiz.sql) cascades every table
-- FK'd to `weeks`, including question_media rows - but the actual
-- uploaded files in the question-media Storage bucket (sql/21_media_
-- storage.sql) live under a "<week_id>/<random>-<filename>" path and
-- were never removed, so deleting a quiz with uploads left its files
-- orphaned in Storage forever. This adds that cleanup as a first step
-- inside the same function, so a single admin_delete_week call still
-- leaves nothing behind.
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

  delete from storage.objects
  where bucket_id = 'question-media'
    and (storage.foldername(name))[1] = p_week_id::text;

  delete from weeks where id = p_week_id;
end;
$$;
