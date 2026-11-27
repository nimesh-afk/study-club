# Roadmap

Each line marked ☐ is meant to be one branch → one pull request. Owner A and B are the two builders.
Suggested split: **A = accounts, security and dashboards**; **B = content pipeline and AI**.

## V1 goal
One student can learn **VCE Chemistry Units 3&4** end to end (start with two or three topics): the mentor uploads the study design and past exams → approves 10–20 topics → approves the question bank → the student uploads notes, passes checkpoints and does daily reviews → topic stages update → all three dashboards show it.

Built to work for **any Victorian high school subject**; Year 8 Mathematics is the second subject.

### M0: Foundations (both)
- ☑ Blank Next.js app deployed to Vercel (`syd1`) with CLAUDE.md, ROADMAP.md, `.env.example`
- ☑ Supabase project created in Sydney; env vars added locally and in Vercel
- ☑ Supabase client helpers (`src/lib/supabase/`) + session proxy

### M1: Accounts and roles (A)
- ☑ Turn off public sign-ups; email login page (6-digit code); auth callback
- ☑ Migration: `profiles`, `student_links` + RLS (consent stored on the student's profile)
- ☑ Admin "add a person" screen (server action using the secret key) with parent consent checkbox for students
- ☑ Role-based routing: student → /student, mentor → /mentor, parent → /parent
- ☑ Custom email sender: Resend via mail.piyatissa.com (studyclub@mail.piyatissa.com)

### M2: Curriculum → objectives (B) — built, now being generalised
- ☑ `src/lib/ai/` wrapper (budget check, per-student daily cap, usage log, safety prompt) + `ai_usage` migration + admin AI check page
- ☑ Anthropic API key (Console, monthly spend limit) in `.env.local` and Vercel; AI check page passes
- ☑ Migration: `subjects`, `source_documents`, `chunks`, `chunk_objectives`, `objectives`, `objective_prereqs` + RLS
- ☑ Mentor upload of source PDFs to the private `sources` bucket (`/mentor/sources`)
- ☑ Text extraction (no AI) and chunking
- ☑ AI proposes objectives + mentor review screen (`/mentor/objectives`)

### M2b: Any subject, 10–20 topics (B)
- ☑ Migration: seed `CHEM34`; add `key_points` and `locked` to `objectives`; per-subject structure (e.g. "Area of Study" vs "Strand") stored on `subjects`
- ☑ Remove Year-8-Maths-only code (subject picker on mentor pages; strands/code prefixes from the subject, not constants)
- ☑ AI proposes **10–20 topics** with key points (replaces fine-grained objectives + prerequisites); review screen shows key points
- ☐ Run it for real: upload the VCE Chemistry study design PDF, propose, review, approve

### M3: Question bank (B)
- ☑ Migration: `questions` + RLS
- ☑ Upload tests/past exams with marking guides or examiner reports (type `past_exam` / `examiner_report`)
- ☑ AI splits papers into questions, pairs answers, tags topic/kind/marks/source/version → drafts
- ◐ Figures: questions that need a diagram are flagged with their page (done); saving the figure image to private storage (to do)
- ☑ Mentor question review: approve all / one, edit, retire; filter by topic and source

### M4: Student flow (A + B)
- ☑ Migration: `notes_submissions`, private `notes` bucket (30-day deletion), `topic_progress` + RLS
- ☑ Step 1: notes photo upload (phone camera) → AI checks coverage of key points → accepted / needs more; mentor override (B)
- ☑ Migration: `checkpoint_attempts` + RLS
- ☑ Step 2: checkpoint quiz — 5–8 random approved questions, 100% to pass, fresh draw each attempt, no wait; wrong answers go into the deck (A + B)
- ☐ Migration: `cards`, `review_logs` + RLS; add `ts-fsrs`
- ☐ `src/lib/srs/`: FSRS wrapper, daily queue (due first, then new, capped), topic stages incl. "Secure", config — pure functions **with unit tests** (A)
- ☐ Step 3: daily review screen — auto-mark MCQ/numeric, self-rate written answers, interleaved across topics (A)

### M5: Dashboards (A)
- ☐ Student: topics with their stage, today's review count, streak
- ☐ Mentor: grid of students × topics (stage), notes waiting for override, question drafts, safety flags
- ☐ Parent: per-child summary (topic stages, time spent, reviews due)

### M6: Guardrails before real use (both)
- ☑ `src/lib/ai/client.ts` wrapper: safety system prompt, budget check, usage logging, per-student daily cap
- ☑ Migration: `safety_flags` + RLS
- ☐ AI disclosure on student screens; privacy page (incl. notes photos and their deletion)
- ☐ Anthropic Console spend limit; Supabase backups checked; decide on Supabase Pro (free projects pause after a week idle)
- ☐ Test pass with three real accounts (student, parent, mentor) on phone, iPad and laptop

**→ V1 release to one student.** Use it for 2 weeks, collect feedback, then continue.

## V1.1 and later (rough order)
1. Year 8 Mathematics (curriculum + textbook + school tests through the same pipeline)
2. Step 4: Feynman — student explains a topic by voice; speech-to-text (provider to decide); AI grades the transcript against a rubric
3. Tune FSRS from real review logs
4. Separate test database for preview links
5. Installable on iPad/phone home screen (PWA), daily review reminders
6. More subjects: Biology 3&4, Chemistry 1&2, …
7. English 3&4 (needs its own design: skills, essay feedback, examiner criteria)
