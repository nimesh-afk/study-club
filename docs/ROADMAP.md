# Roadmap

Each line marked ☐ is meant to be one branch → one pull request. Owner A and B are the two builders.
Suggested split: **A = accounts, security and dashboards**; **B = content pipeline and AI**.

## V1 goal
One student can learn **Year 8 Mathematics** end to end (start with one or two textbook chapters): the mentor uploads the Level 8 curriculum and the textbook PDF → approves objectives → approves content → the student goes through the loop → mastery updates → all three dashboards show it.

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

### M2: Curriculum → objective map (B)
- ☑ `src/lib/ai/` wrapper (budget check, per-student daily cap, usage log, safety prompt) + `ai_usage` migration + admin AI check page — pulled forward from M6
- ☐ Anthropic API key (Console, monthly spend limit) in `.env.local` and Vercel; AI check page passes
- ☐ Migration: `subjects`, `source_documents`, `chunks`, `objectives`, `objective_prereqs` + RLS
- ☐ Mentor upload of source PDFs (curriculum Level 8 Maths, textbook) to a private bucket; text extraction; chunk by section
- ☐ AI proposes objectives (one per curriculum content description, split finer where needed) + prerequisites → saved as `draft`
- ☐ Tag textbook chunks to objectives
- ☐ Mentor review screen: edit, merge, split, approve, set prerequisites

### M3: Content per objective (B)
- ☐ Migration: `content_items` + RLS
- ☐ Generate a draft explanation, 5 retrieval questions and 1 worked example per approved objective, grounded in the tagged textbook chunks
- ☐ Mentor content approval screen

### M4: Student learning loop (A + B)
- ☐ Migration: `attempts`, `mastery` + RLS
- ☐ Mastery engine + decay + next-activity rules as pure functions **with unit tests** (A)
- ☐ Diagnose (3 quick questions) → teach (explanation + worked example) → retrieval (B)
- ☐ Explain-back: student writes in their own words; AI grades against a rubric, returns JSON score + feedback (B)
- ☐ "Today" queue for the student, driven by the engine (A)

### M5: Dashboards (A)
- ☐ Student: objective map coloured by mastery, today's queue, streak
- ☐ Mentor: grid of students × objectives, recent explain-backs, safety flags, draft queue
- ☐ Parent: per-child summary (mastery by area, time spent, what's due)

### M6: Guardrails before real use (both)
- ☑ `src/lib/ai/client.ts` wrapper: safety system prompt, budget check, usage logging, per-student daily cap (done in M2)
- ☐ Migration: `safety_flags` + RLS (`ai_usage` done in M2); tutor creates a flag row on distress
- ☐ AI disclosure on student screens; privacy page
- ☐ Anthropic Console spend limit; Supabase backups checked
- ☐ Test pass with three real accounts (student, parent, mentor) on phone, iPad and laptop

**→ V1 release to one student.** Use it for 2 weeks, collect feedback, then continue.

## V1.1 and later (rough order)
1. Transfer questions from textbook chapter reviews (mastery level 4)
2. Tune decay intervals from real data
3. Add Chemistry 3&4 (study design + examiner reports + past exams, version filtering), then Biology 3&4, Chemistry 1&2
4. Separate test database for preview links
5. Installable on iPad/phone home screen (PWA), reminders
6. Embeddings + pgvector search if tag retrieval isn't enough
7. English 3&4 (needs its own design: skills, essay feedback, examiner criteria)
