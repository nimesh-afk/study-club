# CLAUDE.md — Study Club

This file tells Claude Code (and humans) what this app is, how it is built, and the rules we follow.
Read it fully at the start of every session. If a decision here changes, update this file in the same PR.

Next.js-specific coding guidance (kept up to date by Next.js) is in AGENTS.md:
@AGENTS.md

---

## 1. What we are building

An adaptive learning app for a small, private family study club preparing for VCE.

- **Subjects (in build order):** **Year 8 Mathematics** (Victorian Curriculum 2.0, Level 8) → Chemistry Units 3&4 → Biology Units 3&4 → Chemistry Units 1&2 → English Units 3&4.
- **Users:** students (Year 8–12, about 13–18 years old, **all under 18**), mentors (adults who teach and approve content), parents (adults who watch progress).
- **Devices:** iPad, laptop, phone. Every screen must work on a phone-width screen first.
- **Access:** invite-only. Everyone logs in by email (magic link / one-time code). There is no public sign-up.

### How the learning works
1. A mentor uploads source documents: VCE study design, past exams, examiner reports, notes.
2. The AI breaks the study design into **atomic objectives**: one per key knowledge dot point, with prerequisites. A mentor reviews and approves the map. Nothing reaches a student until it is approved.
3. Each objective gets content: explanation, retrieval questions, worked examples, linked past-exam questions. Mentors approve content too.
4. The student loop: **diagnose → teach → explain back in own words (AI grades) → exam-style transfer questions → spaced repetition.**
5. Each student has a **mastery score per objective (0–4)** that decays over time. An engine picks the next activity.
6. Separate dashboards for student, mentor and parent.

### Mastery scale (do not change without updating this file)
| Score | Meaning | How it's earned |
|---|---|---|
| 0 | Not yet known | Default, or failed diagnosis |
| 1 | Recognises | Retrieval questions correct with hints |
| 2 | Recalls | Retrieval questions correct unaided |
| 3 | Explains | Explain-back graded ≥ pass threshold |
| 4 | Transfers | Exam-style question correct on this objective |

**Decay:** each score has a review interval (default 1, 3, 7, 14, 30 days for scores 0–4). If a review is overdue by more than one interval, the score shown drops by 1 until the student practises again. The intervals live in one config file (`src/lib/mastery/config.ts`).

**Next-activity engine (V1 rules, in priority order):**
1. Overdue reviews (most overdue first).
2. In-progress objectives (score 1–3) whose prerequisites are all ≥ 2.
3. Untouched objectives whose prerequisites are all ≥ 2 → start with diagnosis.
4. Nothing ready? Review the weakest prerequisite.

The engine is plain TypeScript with unit tests. **No AI call decides what comes next.**

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
    (auth)/               # login, auth callback
    student/              # student dashboard + learning loop
    mentor/               # uploads, objective map review, content approval, student overview
    parent/               # read-only progress
  lib/
    supabase/             # client.ts, server.ts, proxy helper
    ai/                   # the only place that calls Claude: models.ts, client.ts, prompts/, safety.ts, budget.ts
    mastery/              # engine, decay, config (pure functions + tests)
    retrieval/            # fetch chunks for an objective, apply source hierarchy
  components/
supabase/
  migrations/             # every schema change is a migration file
docs/
  ROADMAP.md
```

---

## 4. Data model (V1 sketch — migrations are the source of truth)

- `profiles` — id (= auth user id), role (`student` | `mentor` | `parent` | `admin`), display_name, year_level
- `student_links` — student_id, linked_user_id, relationship (`mentor` | `parent`)
- `invites` — email, role, invited_by, consent_recorded_at (parent/guardian consent for students)
- `subjects` — code (e.g. `MATH8`), name, current_study_design_version
- `source_documents` — subject_id, type (`syllabus` | `textbook` | `examiner_report` | `past_exam` | `notes`), title, year, study_design_version, storage_path, status (`uploaded` | `extracted` | `failed`), uploaded_by. **Mentors only.**
- `chunks` — document_id, seq, heading, page_start/page_end, text, source_rank, study_design_version, is_current. **Mentors only**; students get chunks only through server-side retrieval for one objective (5.3, 5.5).
- `chunk_objectives` — chunk_id, objective_id (the objective tags used for retrieval)
- `objectives` — subject_id, unit, area_of_study (Year 8: strand), code, statement, dot_point_text, sort_order, status (`draft` | `approved` | `retired`), approved_by, approved_at. Students/parents see approved only; approved objectives are retired, never deleted.
- `objective_prereqs` — objective_id, prereq_id
- `content_items` — objective_id, kind (`explanation` | `retrieval_q` | `worked_example` | `exam_q`), body (jsonb), source_chunk_ids, status (`draft` | `approved`)
- `attempts` — student_id, objective_id, content_item_id, activity, response, score, ai_feedback, created_at
- `mastery` — student_id, objective_id, score (0–4), last_practised_at, next_due_at
- `ai_usage` — user_id, purpose, model, input_tokens, output_tokens, cost_cents, created_at
- `safety_flags` — student_id, attempt_id, reason, created_at, reviewed_by, reviewed_at

---

## 5. Content rules

### 5.1 Source hierarchy (highest wins when sources disagree)
The "syllabus" is the document that defines the objectives. It depends on the subject.

**Year 8 Mathematics (V1 subject)**
1. Victorian Curriculum 2.0 Mathematics, Level 8 (content descriptions and elaborations): defines the objectives
2. The class textbook (a PDF): explanations, worked examples, exercises
3. Mentor notes

There are no exams or examiner reports at Year 8. The textbook's chapter reviews and harder exercises serve as the "transfer" questions (mastery level 4).

**VCE subjects (later)**
1. VCE study design (current version)
2. VCAA examiner reports
3. VCAA past exams
4. Mentor notes and other notes

### 5.2 Versioning
- Every source document and chunk is tagged with the `study_design_version` it belongs to.
- Content from an older study design is `is_current = false` and **excluded from retrieval by default**. A mentor can re-include a specific item if it's still relevant.
- Past-exam questions from an older design must be checked by a mentor before they're linked to an objective.

### 5.3 Retrieval
- Chunks are tagged to objectives. For any interaction, fetch **only** the chunks tagged to the current objective (plus its direct prerequisites if needed), ordered by source rank.
- V1 retrieves by objective tag (a plain SQL query). We add embeddings and pgvector search later, only if tag-based retrieval proves insufficient. Claude does not create embeddings; that needs a separate embeddings provider, which is a later decision.
- Send the AI the smallest useful context. Never send a whole document.

### 5.4 Approval
- AI-generated objectives and content start as `draft`. **Students only ever see `approved` items.**
- When the AI grades or explains, it must stay within approved content and the retrieved chunks. If it can't answer from them, it says so and suggests asking a mentor. It doesn't make up chemistry or biology.

### 5.5 Copyright
- The textbook PDF is the publisher's copyright, and VCAA documents are VCAA copyright. Keep them in **private** Supabase Storage for club members only. Never share them outside the club.
- Never paste long passages of the textbook into prompts or show them to students wholesale: use the relevant chunk only (5.3).
- **Never commit source documents to the git repo.** Never make them publicly reachable.

---

## 6. Privacy, child safety and AI rules

Students are minors. These rules are not optional, and they apply to every feature.

### 6.1 Data minimisation
- Store a display name (first name is fine), email, year level and role. **No** date of birth, address, phone number, school ID or photos.
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
- Students: read/write their own attempts and mastery; read approved objectives/content.
- Mentors: read their linked students' data; create/approve objectives and content.
- Parents: read their linked students' **progress summaries** (mastery, activity, time). By default they do not see full free-text responses. *(Decision to confirm with the family.)*
- The `SUPABASE_SECRET_KEY` (bypasses RLS) is used only in server code for admin jobs: invites, ingestion, usage logging. Never use it in request paths where the user's own session would do.

### 6.3 AI safety (Anthropic requirements for products used by minors)
- The UI clearly says the tutor is **an AI, not a person**, on the student screens and in the onboarding.
- Every Claude call goes through `src/lib/ai/client.ts`, which:
  - adds the child-safety system prompt (`src/lib/ai/prompts/safety.ts`) and any child-safety prompt Anthropic provides;
  - keeps the tutor on-topic (VCE study only) and age-appropriate;
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
- **V1 = Year 8 Mathematics** (replaced Chemistry 3&4 as the first subject, Nov 2026). Source = Victorian Curriculum 2.0 Maths Level 8 + the class textbook (PDF). Other subjects come after V1 works end to end.
- V1 retrieval by objective tag; pgvector/embeddings deferred.
- English 3&4 is skills-based (text response, argument analysis, writing), not knowledge dot points. It will need its own objective and grading design before we build it.
- **Public GitHub repo** (free branch protection + free Vercel collaboration). Because the code is public: no secrets, student data, real names or VCAA documents in the repo, ever.
- *(open)* What parents can see (summaries only vs full responses).
- Login: 6-digit email code (no magic links). Emails sent via Resend from `studyclub@mail.piyatissa.com` (Supabase custom SMTP). Code verified with `verifyOtp({ type: "email" })`.
- No `invites` table: an admin creates people directly (People page); guardian consent is stored on the student's profile (`guardian_consent_at`, required by a CHECK constraint).
- Light theme only for V1.
- Source PDFs upload straight from the mentor's browser to the private `sources` bucket (Vercel can't take requests over ~4.5 MB); a server action then checks the file and records it.
- Source documents and chunks are readable by mentors/admins only. The tutor fetches one objective's chunks in server code (secret key), so students can never page through the textbook.

---

## 10. Current state (update this as things change)

**Live:** https://study-club-dun.vercel.app · Vercel team `mithuru`, Hobby plan, functions in `syd1`.
Preview links look like `https://study-club-git-<branch>-mithuru.vercel.app` (Vercel login required to view).
**Supabase:** project `study-club` (ref `gufkqduptkzclhsoazbu`), Sydney, org "Mithuru", free plan. Public sign-ups OFF; "automatically expose new tables" OFF; Site URL = live site; redirect allow-list = live `/auth/callback` + `http://localhost:3000/auth/callback`.
**Email:** Resend, domain `mail.piyatissa.com` (verified, Tokyo region, tracking off). The root domain piyatissa.com uses Google Workspace: never touch its DNS records.
**Admin:** Nimesh (`nimesh@piyatissa.com`), role `admin`.

**Done:** M0, M1, the M2 AI wrapper, the M2 curriculum/objectives tables, PDF upload and text extraction (`/mentor/sources`), AI objective proposal (`/mentor/objectives`) (`src/lib/ai/`, admin page `/mentor/ai-check`). Migrations applied: `20261112100000_profiles_and_links`, `20261112230000_ai_usage`, `20261113090000_curriculum_and_objectives`, `20261113100000_sources_bucket`.
**Next:** M2: upload the Victorian Curriculum 2.0 Maths Level 8 PDF (VCAA "Mathematics Level 8 map" .docx exported to PDF; VCAA F–10 site was under maintenance on 12 Nov 2026), extract it, press "Propose objectives with AI" on `/mentor/objectives`; then tag textbook chunks to objectives and build the mentor review screen. Textbook uploaded and extracted: Essential Mathematics for the Victorian Curriculum 8 (3rd ed.), 955 pages → 213 chunks covering 97 sections; chapter openers list the VC2M8 codes each chapter covers (29 codes).

**How work gets done right now**
- Nimesh is new to GitHub. Explain steps plainly; one step at a time.
- Claude works in the connected folder (a Linux VM with the repo mounted), makes branches and commits as `Nimesh Piyatissa <230788794+nimesh-afk@users.noreply.github.com>`, runs eslint + `tsc --noEmit` there (not `npm install` / `next build`: node_modules are macOS builds).
- Claude pushes and opens/merges PRs using a fine-grained GitHub token in `.git/claude-token` (only this repo; Contents + Pull requests; expires Feb 2027). **Never print or log the token.** Merge only after Nimesh says "merge".
- Nimesh runs `npm run dev` on his Mac to test locally.
- Chami (second builder) hasn't joined yet. When she does: add as GitHub collaborator, set ruleset "protect-main" Required approvals to 1, add her on the People page.
