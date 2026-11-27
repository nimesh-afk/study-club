# CLAUDE.md — Study Club

This file tells Claude Code (and humans) what this app is, how it is built, and the rules we follow.
Read it fully at the start of every session. If a decision here changes, update this file in the same PR.

Next.js-specific coding guidance (kept up to date by Next.js) is in AGENTS.md:
@AGENTS.md

---

## 1. What we are building

An adaptive learning app for a small, private family study club, covering **any Victorian high school subject** (Years 7–12).

- **Subjects:** any subject a mentor sets up from its curriculum document: Victorian Curriculum 2.0 (Years 7–10) or a VCE study design (Units 1–4). **Pilot subject: VCE Chemistry Units 3&4** (study design 2024–2027). Year 8 Mathematics comes next; others follow.
- **Users:** students (Year 7–12, about 12–18 years old, **all under 18**), mentors (adults who teach and approve content), parents (adults who watch progress).
- **Devices:** iPad, laptop, phone. Every screen must work on a phone-width screen first.
- **Access:** invite-only. Everyone logs in by email (one-time code). There is no public sign-up.

### Topics
Each subject (per year level or unit pair) is split into **10–20 topics**. The AI proposes them from the curriculum document; a mentor reviews and approves them. Each topic has:
- a short title and statement,
- a list of **key points** (the curriculum dot points it covers), used to check notes and to tag questions,
- a sort order (the study design's order). Mentors can lock topics to keep that order or leave them open. There is no prerequisite graph.

Topics are stored in the existing `objectives` table (one row per topic).

### How the learning works (the student's four steps)
1. **Notes unlock the topic.** The student photographs their handwritten notes for a topic. The AI checks that the notes cover the topic's key points (coverage, not neatness) and says which points are missing. Accepted notes unlock step 2. A mentor can override the AI's decision. Notes are the key that opens a topic; they are not proof of learning.
2. **Checkpoint quiz: 100% to pass.** 5–8 approved questions drawn at random from the topic's question bank, a **fresh draw on every attempt** (avoiding the previous attempt's questions where the bank allows). Instant feedback. **No waiting time** between attempts. Every question the student gets wrong goes straight into their review deck. Passing adds the topic's questions to the student's review deck.
3. **Daily review (Anki style).** Spaced repetition on individual questions, **mixed across all of the student's unlocked topics** (interleaving). Multiple-choice and numeric answers are marked by the app; for written answers the student sees the model answer and rates themselves (Again / Hard / Good / Easy). No AI in the daily review.
4. **Feynman (later, not V1).** The student explains a topic out loud; speech is transcribed and the AI grades the transcript against a rubric. Speech-to-text and this step are built after V1.

### Spaced repetition (FSRS)
- Each question a student studies is a **card** with its own schedule. We use **FSRS** (the Free Spaced Repetition Scheduler used by modern Anki) via the `ts-fsrs` package (MIT licence). A correct answer pushes the next review further out; a lapse brings it back.
- **No separate decay rule:** FSRS tracks forgetting from real answers.
- **Daily load is capped** so students don't drown in overdue cards. Defaults: at most 30 cards a day; due reviews first (most overdue first), then up to 10 new cards. All limits live in one config file (`src/lib/srs/config.ts`).
- What comes next is decided by plain TypeScript with unit tests. **No AI call decides what comes next.**

### Topic progress (do not change without updating this file)
Each student has one stage per topic:

| Stage | Meaning | How it's reached |
|---|---|---|
| Locked | Not started | Default |
| Notes in | Notes accepted | AI (or a mentor) accepts the notes photos |
| Checkpoint passed | Core knowledge checked | 100% on a checkpoint quiz |
| Practising | Reviewing in the daily deck | Automatic after the checkpoint |
| Secure | Remembered over weeks | At least 80% of the topic's cards are scheduled 21+ days out (thresholds in `src/lib/srs/config.ts`) |
| Explained | Can teach it | Feynman step passed (later) |

A topic can fall from Secure back to Practising if the student starts forgetting its cards.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Code | GitHub, one repo | See workflow rules (section 7) |
| App | Next.js (App Router, TypeScript, Tailwind) | Server Components and Server Actions by default |
| Hosting | Vercel | Functions region **`syd1`** (set in `vercel.json`) |
| Database | Supabase Postgres, Sydney (`ap-southeast-2`) | pgvector is available but **not used in V1** (see 5.3) |
| Auth | Supabase Auth (email), via `@supabase/ssr` | Public sign-ups switched OFF in the Supabase dashboard |
| Files | Supabase Storage, **private** buckets only | Signed URLs, short expiry |
| AI | Claude API (Anthropic), server-side only | All calls go through `src/lib/ai/` |

Model names live in **one** place: `src/lib/ai/models.ts`. Default: a Sonnet-class model for tutoring and grading, a Haiku-class model for cheap jobs like tagging and short feedback. Never hard-code a model name anywhere else.

### Environment variables
| Name | Where | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | no (RLS protects data) |
| `SUPABASE_SECRET_KEY` | **server only** | **yes** |
| `ANTHROPIC_API_KEY` | **server only** | **yes** |
| `AI_MONTHLY_BUDGET_CENTS` | server only | no (US cents; AI stays paused if unset) |

- Anything without the `NEXT_PUBLIC_` prefix must never be imported into a Client Component.
- Real values live only in `.env.local` (git-ignored) and in Vercel → Settings → Environment Variables. `.env.example` lists the names with no values.

---

## 3. Folder layout (target)

```
src/
  app/                    # routes
    login/, auth/         # login, auth callback
    student/              # student dashboard, notes upload, checkpoint, daily review
    mentor/               # sources, topic review, question bank, notes overrides, student overview
    parent/               # read-only progress
  lib/
    supabase/             # client.ts, server.ts, proxy helper
    ai/                   # the only place that calls Claude: models.ts, client.ts, prompts/, safety.ts, budget.ts
    srs/                  # FSRS wrapper, daily queue, topic stages, config (pure functions + tests)
    extraction/           # PDF text extraction and splitting (no AI)
  components/
supabase/
  migrations/             # every schema change is a migration file
docs/
  ROADMAP.md
```

---

## 4. Data model (V1 sketch — migrations are the source of truth)

Built:
- `profiles` — id (= auth user id), role (`student` | `mentor` | `parent` | `admin`), display_name, year_level, guardian_consent_at
- `student_links` — student_id, linked_user_id, relationship (`mentor` | `parent`)
- `subjects` — code (e.g. `CHEM34`, `MATH8`), name, current_study_design_version
- `source_documents` — subject_id, type (`syllabus` | `textbook` | `examiner_report` | `past_exam` | `notes`), title, year, study_design_version, storage_path, status (`uploaded` | `extracted` | `failed`), uploaded_by. **Mentors only.**
- `chunks` — document_id, seq, heading, page_start/page_end, text, source_rank, study_design_version, is_current. **Mentors only.**
- `chunk_objectives` — chunk_id, objective_id
- `objectives` — **one row per topic**: subject_id, unit, area_of_study, code, statement, dot_point_text, sort_order, status (`draft` | `approved` | `retired`), approved_by, approved_at. Students/parents see approved only; approved topics are retired, never deleted. *(Needs a `key_points` column and a `locked` flag.)*
- `objective_prereqs` — no longer used for ordering (topics use sort_order); kept until a later clean-up.
- `ai_usage` — user_id, purpose, model, input_tokens, output_tokens, cost_cents, created_at

Planned:
- `questions` — subject_id, objective_id (topic), source_document_id, source_ref (e.g. "2024 exam Section B Q5c"), kind (`mcq` | `numeric` | `short` | `extended`), body (jsonb: stem, options, figure path), answer (jsonb: correct option/value/tolerance or model answer + marking points), marks, study_design_version, is_current, status (`draft` | `approved` | `retired`). Students see approved questions only through server code, one at a time.
- `notes_submissions` — student_id, objective_id, photo paths (private `notes` bucket), ai_result (jsonb: covered/missing key points), status (`checking` | `accepted` | `needs_more`), decided_by (`ai` | mentor id), created_at
- `checkpoint_attempts` — student_id, objective_id, question_ids, answers, score, passed, created_at
- `cards` — student_id, question_id, FSRS fields (due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
- `review_logs` — student_id, card id, rating, review time, previous schedule (kept so FSRS can be tuned later)
- `topic_progress` — student_id, objective_id, stage (see 1. Topic progress), notes_accepted_at, checkpoint_passed_at, secure_at
- `safety_flags` — student_id, reason, created_at, reviewed_by, reviewed_at

---

## 5. Content rules

### 5.1 Source hierarchy (highest wins when sources disagree)
The "syllabus" is the document that defines the topics. It depends on the subject.

**VCE subjects (pilot: Chemistry Units 3&4)**
1. VCE study design (current version): defines the topics and key points
2. VCAA examiner reports (and marking guides)
3. VCAA past exams
4. Textbook, school tests, mentor notes

**Years 7–10 (e.g. Year 8 Mathematics)**
1. Victorian Curriculum 2.0 for that subject and level: defines the topics
2. The class textbook (explanations, exercises, chapter reviews)
3. School tests and mentor notes

### 5.2 Versioning
- Every source document and chunk is tagged with the `study_design_version` it belongs to.
- Content from an older study design is `is_current = false` and **excluded from retrieval by default**. A mentor can re-include a specific item if it's still relevant.
- Past-exam questions from an older design (for Chemistry 3&4: before 2024) are flagged `is_current = false` and excluded by default. A mentor can re-include one that still fits the current design.

### 5.3 Question bank
- Mentors and admins upload tests and past exams (PDF), ideally with their marking guide or examiner report.
- The AI splits each paper into individual questions (multi-part questions become one question per part, keeping the shared stem), pairs each with its answer from the marking guide or report, and tags each with topic, kind, marks, source and study design version. Everything is saved as `draft`.
- A mentor reviews and approves questions in bulk (approve all / approve one / edit / retire), the same way topics are approved.
- **Figures:** questions that need a diagram, graph or table are flagged; the figure is saved as an image (private storage) and shown with the question.
- The checkpoint and daily review only ever use `approved`, `is_current` questions.
- Send the AI the smallest useful context: one paper (or one section of a long paper) at a time, never a whole textbook.

### 5.4 Approval and marking
- AI-generated topics and questions start as `draft`. **Students only ever see `approved` items.**
- Marking: multiple-choice and numeric answers are marked by code (numeric with a tolerance). In the **checkpoint**, short written answers are marked by the cheap AI model against the approved model answer and marking points. In the **daily review**, written answers are self-rated after seeing the model answer (no AI).
- When the AI marks or checks notes, it must stay within the approved key points, questions and answers. If it can't decide, it says so and suggests asking a mentor. It doesn't make up content.

### 5.5 Copyright
- The textbook PDF is the publisher's copyright, and VCAA documents are VCAA copyright. Keep them in **private** Supabase Storage for club members only. Never share them outside the club.
- Never paste long passages of the textbook into prompts or show them to students wholesale.
- **Never commit source documents to the git repo.** Never make them publicly reachable.

---

## 6. Privacy, child safety and AI rules

Students are minors. These rules are not optional, and they apply to every feature.

### 6.1 Data minimisation
- Store a display name (first name is fine), email, year level and role. **No** date of birth, address, phone number, school ID or photos of people.
- **Notes photos** are the one exception for images: photos of handwritten notes only. The upload screen asks students not to include faces, names or anything personal. They live in a **private** `notes` bucket, are visible only to the student, their mentors and admins, and are **deleted 30 days after the notes are decided**; only the AI's result (covered/missing key points) is kept.
- Prompts sent to Claude must **not** contain student names or emails. Use internal IDs only.
- Do not log student responses, prompts or AI outputs to the console or to Vercel logs. Store them only in the database, protected by RLS.
- No third-party analytics, ad, or tracking scripts.

### 6.2 Row-level security (RLS)
- **Every table has RLS enabled, with policies written in the same migration that creates the table.** A PR that adds a table without RLS policies must not be merged.
- **Explicit GRANTs are required.** Our Supabase project has "automatically expose new tables" turned **OFF**, so a new table is not reachable through the API until it is granted. Every migration that creates a table must, in the same file:
  1. `alter table ... enable row level security;`
  2. create the policies;
  3. `grant` only the privileges needed (e.g. `select, insert, update, delete`) to the `authenticated` role.
  - Grant to `anon` **only** if logged-out users truly need it (almost never in this app), and say why in a comment in the migration.
  - GRANTs decide *whether* a role can touch the table at all; RLS policies decide *which rows*. We need both.
- Students: read/write their own notes submissions, checkpoint attempts, cards and review logs; read approved topics. Questions reach students only through server code, one at a time.
- Mentors: read their linked students' data; create/approve topics and questions; override notes decisions.
- Parents: read their linked students' **progress summaries** (topic stages, activity, time). By default they do not see full free-text responses. *(Decision to confirm with the family.)*
- The `SUPABASE_SECRET_KEY` (bypasses RLS) is used only in server code for admin jobs: invites, ingestion, usage logging. Never use it in request paths where the user's own session would do.

### 6.3 AI safety (Anthropic requirements for products used by minors)
- The UI clearly says marking and notes checks are done by **an AI, not a person**, on the student screens and in the onboarding.
- Every Claude call goes through `src/lib/ai/client.ts`, which:
  - adds the child-safety system prompt (`src/lib/ai/prompts/safety.ts`) and any child-safety prompt Anthropic provides;
  - keeps the AI on-topic (school study only) and age-appropriate;
  - checks the monthly budget **before** calling and records usage **after** (`ai_usage`);
  - returns structured output (JSON) for grading.
- If a student's message suggests distress, self-harm or risk of harm: the tutor responds supportively and briefly, gives Kids Helpline (1800 55 1800) and Lifeline (13 11 14), does not continue tutoring in that turn, and creates a `safety_flags` row for a mentor to review.
- A public privacy page describes what is collected, that AI processing happens via Anthropic's API (which may process data outside Australia), how to request deletion, and our child-safety approach.

### 6.4 Spend control
- Hard monthly cap from `AI_MONTHLY_BUDGET_CENTS`. When it's reached, AI features show a friendly "paused until next month, ask a mentor" message. Non-AI features keep working.
- Also set a spend limit in the Anthropic Console as a backstop.
- Per-student daily cap on AI calls (default 150) to catch loops and bugs.

---

## 7. Workflow rules (for both humans and Claude Code)

- **Never commit directly to `main`.** Every task: pull `main` → new branch → small change → pull request → review → merge.
- Branch names: `feat/short-name`, `fix/short-name`, `chore/short-name`.
- One task per branch. Keep PRs small (ideally under ~300 lines changed). Merge within a day or two.
- **Pull before you start:** `git checkout main && git pull`, then branch.
- Split by area to avoid conflicts. Before starting, say which area you're working in.
- Before opening a PR, run: `npm run lint`, `npm run build` and the tests. All must pass.
- Each PR description says: what changed, how to test it on the Vercel preview link, and any new env vars or migrations.
- Schema changes: only via new files in `supabase/migrations/`. Never edit an old migration that's already merged.
- How a migration is applied (current practice, CLI not linked yet):
  1. Write the file as `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` (tables + RLS + policies + grants together).
  2. Test it against a local Postgres with stub `auth` schema and roles, including RLS checks per role.
  3. After the PR is approved and **before merging**, run it in the Supabase SQL Editor inside `begin; … commit;`, and in the same transaction record it:
     `insert into supabase_migrations.schema_migrations (version, name) values ('<YYYYMMDDHHMMSS>', '<name>');`
     (This keeps the history compatible with `npx supabase db push` if we link the CLI later.)
  4. Then merge. (One database serves previews and production for now, so code that needs a new table only works once it's applied.)
- **Never commit:** `.env*` files with values, API keys, student data, the textbook, or VCAA documents.
- Ask before adding a new npm dependency, and explain why it's needed.
- Prefer simple, readable code over clever code. Two beginners maintain this.
- When unsure about a product decision, stop and ask rather than guess. Record the answer in section 9.

### Commands
```
npm run dev        # local app at http://localhost:3000
npm run lint
npm run build
npm test           # once tests are set up
```

---

## 8. Definition of done (V1 features)
- Works on phone width and iPad.
- RLS policies exist and were tested with a student account, a parent account and a mentor account.
- No secrets or student data in code, logs or the PR.
- Every AI call is logged in `ai_usage` and respects the budget.
- The Vercel preview link was checked by the other person before merging.

---

## 9. Decisions log
- Hosting in Sydney regions (Vercel `syd1`, Supabase `ap-southeast-2`).
- No local LLM / Mac mini.
- Invite-only, email login.
- ~~V1 = Year 8 Mathematics~~ (Nov 2026, superseded 27 Nov 2026 below).
- **27 Nov 2026: new learning design.** The app covers any Victorian high school subject (Years 7–12). **Pilot subject: VCE Chemistry Units 3&4** (study design 2024–2027; 2027 is its last year). Year 8 Mathematics comes next.
- Subjects are split into **10–20 topics** (stored in `objectives`), each with key points. Topic order = study design order; no prerequisite graph.
- Student flow: **notes photos unlock a topic → checkpoint quiz (100%, fresh random draw each attempt, no wait between attempts) → daily spaced-repetition review → Feynman voice explanation (later)**. This replaces the old diagnose → teach → explain-back loop and the 0–4 mastery score with decay.
- **Spaced repetition: FSRS via `ts-fsrs`** (MIT), scheduling individual questions, mixed across topics, with a daily cap. Dependency approved by Nimesh; add it in the PR that builds the review step.
- Question bank is built from uploaded tests and past exams: AI extracts and tags questions, mentors approve in bulk.
- Daily review written answers are self-rated (no AI); checkpoint short answers are AI-marked against the model answer.
- Notes photos: AI decides, mentor can override; photos deleted 30 days after the decision.
- Speech-to-text provider for the Feynman step: decide later.
- Retrieval by tag; pgvector/embeddings deferred.
- English 3&4 is skills-based (text response, argument analysis, writing), not knowledge dot points. It will need its own objective and grading design before we build it.
- **Public GitHub repo** (free branch protection + free Vercel collaboration). Because the code is public: no secrets, student data, real names or VCAA documents in the repo, ever.
- *(open)* What parents can see (summaries only vs full responses).
- Login: 6-digit email code (no magic links). Emails sent via Resend from `studyclub@mail.piyatissa.com` (Supabase custom SMTP). Code verified with `verifyOtp({ type: "email" })`.
- No `invites` table: an admin creates people directly (People page); guardian consent is stored on the student's profile (`guardian_consent_at`, required by a CHECK constraint).
- Light theme only for V1.
- **Topics are set up once a year per subject** (new curriculum/textbook upload → extract → AI proposes → mentor reviews and approves). So the review screen is deliberately simple: edit, delete drafts, approve one or all, retire. No merge/split tools: edit, delete or propose again instead.
- Source PDFs upload straight from the mentor's browser to the private `sources` bucket (Vercel can't take requests over ~4.5 MB); a server action then checks the file and records it.
- Source documents and chunks are readable by mentors/admins only, so students can never page through the textbook or exams.

---

## 10. Current state (update this as things change)

**Live:** https://study-club-dun.vercel.app · Vercel team `mithuru`, Hobby plan, functions in `syd1`.
Preview links look like `https://study-club-git-<branch>-mithuru.vercel.app` (Vercel login required to view).
**Supabase:** project `study-club` (ref `gufkqduptkzclhsoazbu`), Sydney, org "Mithuru", free plan. Public sign-ups OFF; "automatically expose new tables" OFF; Site URL = live site; redirect allow-list = live `/auth/callback` + `http://localhost:3000/auth/callback`.
**Email:** Resend, domain `mail.piyatissa.com` (verified, Tokyo region, tracking off). The root domain piyatissa.com uses Google Workspace: never touch its DNS records.
**Admin:** Nimesh (`nimesh@piyatissa.com`), role `admin`.

**Done:** M0, M1, the M2 AI wrapper, the M2 curriculum/objectives tables, PDF upload and text extraction (`/mentor/sources`), AI objective proposal and mentor review (`/mentor/objectives`, `/mentor/objectives/[id]`) (`src/lib/ai/`, admin page `/mentor/ai-check`). Migrations applied: `20261112100000_profiles_and_links`, `20261112230000_ai_usage`, `20261113090000_curriculum_and_objectives`, `20261113100000_sources_bucket`.
**Next:** see `docs/ROADMAP.md`. First: make subjects and topics generic (M2b), set up `CHEM34`, upload the VCE Chemistry study design (VCAA .docx exported to PDF), propose and approve 10–20 topics. Then the question bank (M3).
Year 8 Maths so far: textbook uploaded and extracted (Essential Mathematics for the Victorian Curriculum 8, 3rd ed., 955 pages → 213 chunks); no curriculum or objectives yet.

**How work gets done right now**
- Nimesh is new to GitHub. Explain steps plainly; one step at a time.
- Claude makes branches and commits as `Nimesh Piyatissa <230788794+nimesh-afk@users.noreply.github.com>`, pushes and opens/merges PRs through the Claude GitHub App (connected 27 Nov 2026). Merge only after Nimesh says "merge". After a merge, Claude brings Nimesh's Mac copy (`~/Documents/study-club`) up to date on `main`.
- Older setup: a fine-grained GitHub token in `.git/claude-token` on the Mac (expires Feb 2027). **Never print or log the token.**
- Nimesh runs `npm run dev` on his Mac to test locally.
- Chami (second builder) hasn't joined yet. When she does: add as GitHub collaborator, set ruleset "protect-main" Required approvals to 1, add her on the People page.
