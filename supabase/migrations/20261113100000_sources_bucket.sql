-- M2: private Storage bucket for source PDFs (curriculum, textbook, notes)
-- CLAUDE.md 5.5: copyright material, PRIVATE bucket only, club members only.
--   * The bucket is not public: files are never reachable by URL without a
--     short-lived signed link.
--   * Only mentors and admins can upload, list, read or delete files here.
--     Students and parents never touch this bucket.
--   * PDFs only, at most 50 MB each (the Supabase free plan limit).
-- Files go straight from the mentor's browser to Storage (Vercel can't take
-- requests over ~4.5 MB), then the app records them in source_documents.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sources', 'sources', false, 52428800, array['application/pdf']);

create policy "sources bucket: mentors read"
  on storage.objects for select to authenticated
  using (bucket_id = 'sources' and (select private.is_mentor()));

create policy "sources bucket: mentors upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sources' and (select private.is_mentor()));

create policy "sources bucket: mentors delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'sources' and (select private.is_mentor()));
