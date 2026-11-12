-- M2: curriculum, source documents, textbook chunks, objectives
-- Creates: subjects, source_documents, chunks, objectives, objective_prereqs, chunk_objectives.
-- Security model (see CLAUDE.md 5.5 and 6.2):
--   * Source documents and chunks are copyright material (textbook, curriculum).
--     Only mentors and admins can read them through their own session. Students
--     and parents never read chunks directly: the tutor fetches just the chunks
--     for one objective in server code (CLAUDE.md 5.3).
--   * Students and parents can read APPROVED objectives and their prerequisites
--     (dashboards need the names). Mentors and admins read and edit everything.
--   * Text extraction and AI proposals write through server code (service_role).
--   * anon (logged-out visitors) gets nothing.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
-- "syllabus" is whatever defines the objectives: the Victorian Curriculum for
-- Year 8, the VCE study design for VCE subjects (CLAUDE.md 5.1).
create type public.source_type as enum
  ('syllabus', 'textbook', 'examiner_report', 'past_exam', 'notes');
create type public.document_status as enum ('uploaded', 'extracted', 'failed');
create type public.objective_status as enum ('draft', 'approved', 'retired');

-- ---------------------------------------------------------------------------
-- Private helper: is the current user a mentor or admin?
-- ---------------------------------------------------------------------------
create or replace function private.is_mentor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('mentor', 'admin')
  );
$$;

revoke all on function private.is_mentor() from public;
grant execute on function private.is_mentor() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.subjects (
  id                            uuid primary key default gen_random_uuid(),
  code                          text not null unique check (code ~ '^[A-Z0-9]{2,12}$'),
  name                          text not null check (char_length(name) between 1 and 80),
  -- Version of the syllabus currently taught, e.g. 'VC2.0' or 'VCE Chemistry 2024'.
  current_study_design_version  text not null,
  created_at                    timestamptz not null default now()
);

create table public.source_documents (
  id                    uuid primary key default gen_random_uuid(),
  subject_id            uuid not null references public.subjects (id) on delete cascade,
  type                  public.source_type not null,
  title                 text not null check (char_length(title) between 1 and 200),
  year                  smallint check (year between 2000 and 2100),
  study_design_version  text not null,
  -- Path inside the PRIVATE storage bucket. Never a public URL.
  storage_path          text not null unique,
  status                public.document_status not null default 'uploaded',
  page_count            integer check (page_count > 0),
  uploaded_by           uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index source_documents_subject_id_idx on public.source_documents (subject_id);

create table public.chunks (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references public.source_documents (id) on delete cascade,
  -- Order within the document (1, 2, 3 ...).
  seq                   integer not null check (seq > 0),
  heading               text,
  page_start            integer check (page_start > 0),
  page_end              integer check (page_end >= page_start),
  text                  text not null,
  -- 1 = highest authority (CLAUDE.md 5.1). Copied from the document type at extraction.
  source_rank           smallint not null check (source_rank between 1 and 9),
  study_design_version  text not null,
  is_current            boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (document_id, seq)
);

create table public.objectives (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid not null references public.subjects (id) on delete cascade,
  -- VCE: "Unit 3". Year 8: null.
  unit            text,
  -- VCE: area of study. Year 8: the strand (Number, Algebra, Measurement, Space, Statistics, Probability).
  area_of_study   text not null,
  -- Curriculum code, plus a suffix if one content description is split (e.g. VC2M8N01.2).
  code            text not null check (char_length(code) between 1 and 40),
  -- What the student should be able to do, in plain words.
  statement       text not null check (char_length(statement) between 1 and 500),
  -- The curriculum wording this came from.
  dot_point_text  text,
  sort_order      integer not null default 0,
  status          public.objective_status not null default 'draft',
  approved_by     uuid references public.profiles (id) on delete set null,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (subject_id, code),
  constraint approved_objectives_record_approval
    check (status <> 'approved' or approved_at is not null)
);

create index objectives_subject_id_idx on public.objectives (subject_id, sort_order);

create table public.objective_prereqs (
  objective_id  uuid not null references public.objectives (id) on delete cascade,
  prereq_id     uuid not null references public.objectives (id) on delete cascade,
  primary key (objective_id, prereq_id),
  constraint no_self_prereq check (objective_id <> prereq_id)
);

create index objective_prereqs_prereq_id_idx on public.objective_prereqs (prereq_id);

-- Which chunks teach which objective (CLAUDE.md 5.3: retrieval by objective tag).
create table public.chunk_objectives (
  chunk_id      uuid not null references public.chunks (id) on delete cascade,
  objective_id  uuid not null references public.objectives (id) on delete cascade,
  primary key (chunk_id, objective_id)
);

create index chunk_objectives_objective_id_idx on public.chunk_objectives (objective_id);

create trigger source_documents_set_updated_at
  before update on public.source_documents
  for each row execute function private.set_updated_at();

create trigger objectives_set_updated_at
  before update on public.objectives
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.subjects          enable row level security;
alter table public.source_documents  enable row level security;
alter table public.chunks            enable row level security;
alter table public.objectives        enable row level security;
alter table public.objective_prereqs enable row level security;
alter table public.chunk_objectives  enable row level security;

-- subjects: everyone logged in can see the subject list.
create policy "subjects: read all"
  on public.subjects for select to authenticated
  using (true);

-- source_documents: mentors only.
create policy "source_documents: mentors read"
  on public.source_documents for select to authenticated
  using ((select private.is_mentor()));

create policy "source_documents: mentors add, as themselves"
  on public.source_documents for insert to authenticated
  with check ((select private.is_mentor()) and uploaded_by = (select auth.uid()));

create policy "source_documents: mentors update"
  on public.source_documents for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "source_documents: mentors delete"
  on public.source_documents for delete to authenticated
  using ((select private.is_mentor()));

-- chunks and chunk tags: mentors read and edit tags; chunks are written by server code.
create policy "chunks: mentors read"
  on public.chunks for select to authenticated
  using ((select private.is_mentor()));

create policy "chunk_objectives: mentors read"
  on public.chunk_objectives for select to authenticated
  using ((select private.is_mentor()));

create policy "chunk_objectives: mentors add"
  on public.chunk_objectives for insert to authenticated
  with check ((select private.is_mentor()));

create policy "chunk_objectives: mentors remove"
  on public.chunk_objectives for delete to authenticated
  using ((select private.is_mentor()));

-- objectives: students/parents see approved ones; mentors see and edit all.
create policy "objectives: read approved, or all if mentor"
  on public.objectives for select to authenticated
  using (status = 'approved' or (select private.is_mentor()));

create policy "objectives: mentors add"
  on public.objectives for insert to authenticated
  with check ((select private.is_mentor()));

create policy "objectives: mentors update"
  on public.objectives for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

-- Only drafts can be deleted. Approved objectives are retired instead,
-- so student history stays attached to them.
create policy "objectives: mentors delete drafts"
  on public.objectives for delete to authenticated
  using ((select private.is_mentor()) and status = 'draft');

-- objective_prereqs: visible when both objectives are approved, or to mentors.
create policy "objective_prereqs: read approved pairs, or all if mentor"
  on public.objective_prereqs for select to authenticated
  using (
    (select private.is_mentor())
    or (
      exists (select 1 from public.objectives o where o.id = objective_id and o.status = 'approved')
      and exists (select 1 from public.objectives o where o.id = prereq_id and o.status = 'approved')
    )
  );

create policy "objective_prereqs: mentors add"
  on public.objective_prereqs for insert to authenticated
  with check ((select private.is_mentor()));

create policy "objective_prereqs: mentors remove"
  on public.objective_prereqs for delete to authenticated
  using ((select private.is_mentor()));

-- ---------------------------------------------------------------------------
-- Grants (auto-expose is OFF, so nothing is reachable until granted)
-- ---------------------------------------------------------------------------
revoke all on public.subjects, public.source_documents, public.chunks,
  public.objectives, public.objective_prereqs, public.chunk_objectives
  from anon, authenticated;

grant select on public.subjects to authenticated;
grant select, insert, delete on public.source_documents to authenticated;
-- Mentors may rename or retire a document; they can't move its file or fake who uploaded it.
grant update (title, year, study_design_version, status) on public.source_documents to authenticated;
grant select on public.chunks to authenticated;
grant select, insert, delete on public.chunk_objectives to authenticated;
grant select, insert, delete on public.objectives to authenticated;
grant update (unit, area_of_study, code, statement, dot_point_text, sort_order, status,
              approved_by, approved_at) on public.objectives to authenticated;
grant select, insert, delete on public.objective_prereqs to authenticated;

-- Server code (secret key): ingestion, AI proposals.
grant select, insert, update, delete on public.subjects, public.source_documents,
  public.chunks, public.objectives, public.objective_prereqs, public.chunk_objectives
  to service_role;
grant usage on type public.source_type, public.document_status, public.objective_status
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The first subject (CLAUDE.md 9: V1 = Year 8 Mathematics)
-- ---------------------------------------------------------------------------
insert into public.subjects (code, name, current_study_design_version)
values ('MATH8', 'Year 8 Mathematics', 'VC2.0');
