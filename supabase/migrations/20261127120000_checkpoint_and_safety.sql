-- M4 step 2: checkpoint quiz (CLAUDE.md 1), and safety flags (CLAUDE.md 6.3).
-- Creates: checkpoint_attempts, safety_flags.
-- Security model (CLAUDE.md 6.2):
--   * Scores and pass/fail must be trustworthy, so server code writes
--     checkpoint_attempts (service_role). The student, linked mentors and
--     admins can read them. Parents can't (they see topic stages instead).
--   * safety_flags: written by server code when the AI notices signs of
--     distress in a student's answer. Linked mentors and admins can read them
--     and mark them reviewed. Students and parents can't see them.
--   * anon gets nothing.

create type public.attempt_status as enum ('open', 'marked');

create table public.checkpoint_attempts (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles (id) on delete cascade,
  objective_id  uuid not null references public.objectives (id) on delete cascade,
  -- The questions drawn for this attempt, in the order shown.
  question_ids  uuid[] not null check (cardinality(question_ids) between 1 and 20),
  status        public.attempt_status not null default 'open',
  -- [{"question_id": "...", "response": "...", "correct": true, "feedback": "..."}]
  results       jsonb,
  score         smallint check (score >= 0),
  total         smallint check (total >= 0),
  passed        boolean,
  created_at    timestamptz not null default now(),
  marked_at     timestamptz
);

create index checkpoint_attempts_student_idx
  on public.checkpoint_attempts (student_id, objective_id, created_at desc);

create table public.safety_flags (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles (id) on delete cascade,
  -- Where it came from, e.g. 'checkpoint'. The student's words stay where
  -- they were written (e.g. the attempt's results); this row just points there.
  source        text not null check (source in ('checkpoint', 'notes', 'review')),
  source_id     uuid,
  reason        text not null check (char_length(reason) between 1 and 300),
  created_at    timestamptz not null default now(),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz
);

create index safety_flags_open_idx on public.safety_flags (reviewed_at, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.checkpoint_attempts enable row level security;
alter table public.safety_flags enable row level security;

create policy "checkpoint_attempts: student, linked mentors, admins read"
  on public.checkpoint_attempts for select to authenticated
  using (
    student_id = (select auth.uid())
    or (select private.can_mentor_student(student_id))
  );

create policy "safety_flags: linked mentors and admins read"
  on public.safety_flags for select to authenticated
  using ((select private.can_mentor_student(student_id)));

create policy "safety_flags: linked mentors and admins mark reviewed"
  on public.safety_flags for update to authenticated
  using ((select private.can_mentor_student(student_id)))
  with check ((select private.can_mentor_student(student_id)) and reviewed_by = (select auth.uid()));

revoke all on public.checkpoint_attempts, public.safety_flags from anon, authenticated;
grant select on public.checkpoint_attempts, public.safety_flags to authenticated;
grant update (reviewed_by, reviewed_at) on public.safety_flags to authenticated;
grant select, insert, update, delete on public.checkpoint_attempts, public.safety_flags to service_role;
grant usage on type public.attempt_status to authenticated, service_role;
