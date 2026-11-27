-- M3: question bank (CLAUDE.md 5.3, 5.4).
-- Creates: questions. Questions come from uploaded tests and past exams: the AI
-- extracts them as drafts, a mentor approves them.
-- Security model (CLAUDE.md 6.2):
--   * Questions and answers are exam material (VCAA copyright, school tests).
--     Only mentors and admins read or edit them through their own session.
--   * Students and parents never read this table directly: the checkpoint and
--     daily review (M4) fetch one approved question at a time in server code,
--     and never send the answer to the browser before the student has answered.
--   * AI extraction writes through the mentor's session (mentors can insert).
--   * anon (logged-out visitors) gets nothing.

create type public.question_kind as enum ('mcq', 'numeric', 'short', 'extended');
create type public.question_status as enum ('draft', 'approved', 'retired');

create table public.questions (
  id                    uuid primary key default gen_random_uuid(),
  subject_id            uuid not null references public.subjects (id) on delete cascade,
  -- The topic (objectives row). Null when the AI couldn't place it: a mentor picks one.
  objective_id          uuid references public.objectives (id) on delete set null,
  source_document_id    uuid references public.source_documents (id) on delete set null,
  -- Where it came from, e.g. "2024 exam, Section B, Q5c".
  source_ref            text check (char_length(source_ref) <= 120),
  -- Order within the source, so the review screen lists them like the paper.
  source_seq            integer not null default 0,
  kind                  public.question_kind not null,
  -- Shared stem of a multi-part question (e.g. the scenario before 5a, 5b, 5c).
  context               text check (char_length(context) <= 6000),
  stem                  text not null check (char_length(stem) between 1 and 6000),
  -- MCQ only: [{"label": "A", "text": "..."}, ...]
  options               jsonb check (options is null or jsonb_typeof(options) = 'array'),
  -- mcq:     {"correct_option": "B"}
  -- numeric: {"value": 0.0251, "unit": "mol", "tolerance_pct": 2, "model_answer": "...", "marking_points": [...]}
  -- short / extended: {"model_answer": "...", "marking_points": ["...", "..."]}
  answer                jsonb not null check (jsonb_typeof(answer) = 'object'),
  marks                 smallint check (marks between 1 and 30),
  -- The question needs a diagram, graph or table that isn't in the text.
  needs_figure          boolean not null default false,
  figure_page           integer check (figure_page > 0),
  -- Private storage path of the figure image (added later).
  figure_path           text,
  study_design_version  text not null,
  is_current            boolean not null default true,
  status                public.question_status not null default 'draft',
  approved_by           uuid references public.profiles (id) on delete set null,
  approved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint approved_questions_record_approval
    check (status <> 'approved' or approved_at is not null),
  constraint mcq_has_options
    check (kind <> 'mcq' or (options is not null and answer ? 'correct_option'))
);

create index questions_subject_idx on public.questions (subject_id, status);
create index questions_objective_idx on public.questions (objective_id);
create index questions_source_idx on public.questions (source_document_id, source_seq);

create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: mentors and admins only.
-- ---------------------------------------------------------------------------
alter table public.questions enable row level security;

create policy "questions: mentors read"
  on public.questions for select to authenticated
  using ((select private.is_mentor()));

create policy "questions: mentors add"
  on public.questions for insert to authenticated
  with check ((select private.is_mentor()));

create policy "questions: mentors update"
  on public.questions for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

-- Only drafts can be deleted. Approved questions are retired instead, so
-- students' review history stays attached to them.
create policy "questions: mentors delete drafts"
  on public.questions for delete to authenticated
  using ((select private.is_mentor()) and status = 'draft');

-- ---------------------------------------------------------------------------
-- Grants (auto-expose is OFF)
-- ---------------------------------------------------------------------------
revoke all on public.questions from anon, authenticated;
grant select, insert, delete on public.questions to authenticated;
grant update (objective_id, source_ref, kind, context, stem, options, answer, marks,
              needs_figure, figure_page, figure_path, is_current, status,
              approved_by, approved_at) on public.questions to authenticated;
grant select, insert, update, delete on public.questions to service_role;
grant usage on type public.question_kind, public.question_status to authenticated, service_role;
