-- M4 step 1: notes photos unlock a topic (CLAUDE.md 1 "How the learning works", 6.1).
-- Creates: topic_progress (one row per student per topic), notes_submissions,
-- and the private "notes" Storage bucket.
-- Security model (CLAUDE.md 6.1, 6.2):
--   * A student reads only their own rows; their linked mentors and parents,
--     and admins, can read them too (parents: CLAUDE.md 6.2 progress summaries).
--   * Nobody writes these tables through the API. Stages and AI results must be
--     trustworthy, so server code writes them (service_role) after checking who
--     is asking: the student for their own notes, a linked mentor or an admin
--     for an override.
--   * Notes photos: private bucket, folder = the student's id. A student can
--     upload to and read their own folder; linked mentors and admins can read.
--     Photos are deleted 30 days after a decision (server code does this).
--   * anon (logged-out visitors) gets nothing.

-- ---------------------------------------------------------------------------
-- Private helper: can the current user see this student's work?
-- (the student themself, a linked mentor or parent, or an admin)
-- ---------------------------------------------------------------------------
create or replace function private.can_view_student(student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) = student
    or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
    or exists (
      select 1 from public.student_links
      where student_id = student and linked_user_id = (select auth.uid())
    );
$$;

-- Linked mentors and admins only (parents can't see notes photos or AI feedback).
create or replace function private.can_mentor_student(student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
    or exists (
      select 1 from public.student_links
      where student_id = student and linked_user_id = (select auth.uid())
        and relationship = 'mentor'
    );
$$;

-- Same check for a Storage folder name (text), so a folder that isn't an id
-- (e.g. in another bucket) can never cause a cast error.
create or replace function private.can_mentor_student_folder(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
    or exists (
      select 1 from public.student_links
      where student_id::text = folder and linked_user_id = (select auth.uid())
        and relationship = 'mentor'
    );
$$;

revoke all on function private.can_view_student(uuid), private.can_mentor_student(uuid),
  private.can_mentor_student_folder(text) from public;
grant execute on function private.can_view_student(uuid), private.can_mentor_student(uuid),
  private.can_mentor_student_folder(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Types and tables
-- ---------------------------------------------------------------------------
create type public.topic_stage as enum
  ('locked', 'notes_in', 'checkpoint_passed', 'practising', 'secure', 'explained');
create type public.notes_status as enum ('checking', 'accepted', 'needs_more', 'failed');

create table public.topic_progress (
  student_id            uuid not null references public.profiles (id) on delete cascade,
  objective_id          uuid not null references public.objectives (id) on delete cascade,
  stage                 public.topic_stage not null default 'locked',
  notes_accepted_at     timestamptz,
  checkpoint_passed_at  timestamptz,
  secure_at             timestamptz,
  updated_at            timestamptz not null default now(),
  primary key (student_id, objective_id)
);

create index topic_progress_objective_idx on public.topic_progress (objective_id);

create table public.notes_submissions (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.profiles (id) on delete cascade,
  objective_id    uuid not null references public.objectives (id) on delete cascade,
  -- Paths in the private "notes" bucket: <student_id>/<random id>.jpg
  photo_paths     text[] not null check (cardinality(photo_paths) between 1 and 10),
  status          public.notes_status not null default 'checking',
  -- {"key_points": [{"point": "...", "covered": "yes|partly|no"}], "feedback": "...", "readable": true}
  ai_result       jsonb,
  -- Who decided: 'ai' or 'mentor'.
  decided_by      text check (decided_by in ('ai', 'mentor')),
  decided_by_user uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  -- Set when the photos have been deleted (30 days after the decision).
  photos_deleted_at timestamptz,
  created_at      timestamptz not null default now()
);

create index notes_submissions_student_idx on public.notes_submissions (student_id, objective_id, created_at desc);
create index notes_submissions_status_idx on public.notes_submissions (status, decided_at);

create trigger topic_progress_set_updated_at
  before update on public.topic_progress
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: read-only through the API.
-- ---------------------------------------------------------------------------
alter table public.topic_progress enable row level security;
alter table public.notes_submissions enable row level security;

create policy "topic_progress: student, linked adults, admins read"
  on public.topic_progress for select to authenticated
  using ((select private.can_view_student(student_id)));

create policy "notes_submissions: student, linked mentors, admins read"
  on public.notes_submissions for select to authenticated
  using (
    student_id = (select auth.uid())
    or (select private.can_mentor_student(student_id))
  );

revoke all on public.topic_progress, public.notes_submissions from anon, authenticated;
grant select on public.topic_progress, public.notes_submissions to authenticated;
grant select, insert, update, delete on public.topic_progress, public.notes_submissions
  to service_role;
grant usage on type public.topic_stage, public.notes_status to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: private "notes" bucket. Images only, 10 MB each (the app shrinks
-- photos before upload, so they're usually well under 1 MB).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notes', 'notes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']);

create policy "notes bucket: students upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'notes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "notes bucket: student, linked mentors, admins read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'notes'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select private.can_mentor_student_folder((storage.foldername(name))[1]))
    )
  );
