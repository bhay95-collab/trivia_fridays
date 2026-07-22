-- ============================================================
-- TRIVIA FRIDAYS - MEDIA UPLOADS
-- Paste this whole file into Supabase > SQL Editor > Run
-- Safe to re-run.
--
-- Question media has only ever taken an HTTPS link - host_save_question
-- still requires that (see sql/20_closest_wins.sql), and nothing about
-- question_media or that function changes here. This just adds a
-- Storage bucket so a host can upload a picture, clip, or track
-- straight from their device; the app stores the file's public URL
-- exactly like it would store a pasted link.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-media', 'question-media', true, 26214400, array['image/*','audio/*','video/*'])
on conflict (id) do update
set public              = excluded.public,
    file_size_limit      = excluded.file_size_limit,
    allowed_mime_types    = excluded.allowed_mime_types;

-- Uploads are written to "<week_id>/<random>-<filename>" - the first
-- path segment is the week, so is_host_of() (sql/01_schema.sql) is
-- enough to gate writes without a new table or column.
drop policy if exists "question_media_read"   on storage.objects;
drop policy if exists "question_media_insert" on storage.objects;
drop policy if exists "question_media_update" on storage.objects;
drop policy if exists "question_media_delete" on storage.objects;

-- The bucket is public, so downloads already bypass RLS via the
-- public URL - this just keeps the storage API (list/download)
-- consistent with that, same visibility model as a pasted link.
create policy "question_media_read" on storage.objects for select
  using (bucket_id = 'question-media');

create policy "question_media_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'question-media' and is_host_of((storage.foldername(name))[1]::uuid));

create policy "question_media_update" on storage.objects for update to authenticated
  using (bucket_id = 'question-media' and is_host_of((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'question-media' and is_host_of((storage.foldername(name))[1]::uuid));

create policy "question_media_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'question-media' and is_host_of((storage.foldername(name))[1]::uuid));
