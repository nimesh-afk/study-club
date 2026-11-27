-- M2b: any subject, 10–20 topics per subject (CLAUDE.md 1 "Topics", 9: 27 Nov 2026).
-- Changes:
--   * subjects: how each subject is organised (level, grouping label, which part
--     of the curriculum document to use, optional curriculum code prefix).
--   * objectives: now one row per TOPIC. Adds a short title, key points
--     (the curriculum dot points the topic covers) and a "locked" flag
--     (locked = the student must finish earlier topics first).
--   * Seeds VCE Chemistry Units 3&4 (pilot subject) and fills in Year 8 Maths.
-- Security (CLAUDE.md 6.2): no new tables. RLS policies are unchanged: every
-- logged-in user can read subjects; mentors edit objectives. New objective
-- columns get column-level UPDATE grants like the existing ones. Subjects stay
-- read-only to logged-in users (server code or SQL adds subjects for now).

-- ---------------------------------------------------------------------------
-- subjects
-- ---------------------------------------------------------------------------
alter table public.subjects
  -- Shown to people, e.g. 'Units 3 and 4' or 'Year 8'.
  add column level_label text check (char_length(level_label) between 1 and 40),
  -- What the curriculum calls its groups: 'Area of study' (VCE) or 'Strand' (Years 7–10).
  add column grouping_label text not null default 'Area of study'
    check (char_length(grouping_label) between 1 and 40),
  -- Which part of the curriculum document to use, told to the AI,
  -- e.g. 'Units 3 and 4 only' when the study design covers Units 1–4.
  add column scope_note text check (char_length(scope_note) <= 300),
  -- Optional: curriculum codes start with this (e.g. 'VC2M8'). Used to cut a big
  -- multi-level curriculum file down to the right level.
  add column curriculum_code_prefix text check (curriculum_code_prefix ~ '^[A-Z0-9]{2,12}$');

-- ---------------------------------------------------------------------------
-- objectives (= topics)
-- ---------------------------------------------------------------------------
alter table public.objectives
  add column title text check (char_length(title) between 1 and 80),
  -- The curriculum dot points this topic covers, copied word for word.
  -- Used to check student notes and to tag questions.
  add column key_points text[] not null default '{}'
    check (cardinality(key_points) <= 30),
  -- Locked = students must pass the earlier topics' checkpoints first.
  add column locked boolean not null default false;

grant update (title, key_points, locked) on public.objectives to authenticated;

-- ---------------------------------------------------------------------------
-- Subjects
-- ---------------------------------------------------------------------------
update public.subjects
set level_label = 'Year 8',
    grouping_label = 'Strand',
    scope_note = 'Level 8 only',
    curriculum_code_prefix = 'VC2M8'
where code = 'MATH8';

insert into public.subjects
  (code, name, current_study_design_version, level_label, grouping_label, scope_note)
values
  ('CHEM34', 'VCE Chemistry Units 3&4', 'VCE Chemistry 2024–2027', 'Units 3 and 4',
   'Area of study', 'Units 3 and 4 only (ignore Units 1 and 2)')
on conflict (code) do nothing;
