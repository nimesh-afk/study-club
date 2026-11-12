# CLAUDE.md — Study Club

This file tells Claude Code (and humans) what this app is, how it is built, and the rules we follow.
Read it fully at the start of every session. If a decision here changes, update this file in the same PR.

Next.js-specific coding guidance (kept up to date by Next.js) is in AGENTS.md:
@AGENTS.md

---

## 1. What we are building

An adaptive learning app for a small, private family study club preparing for VCE.

- **Subjects (in build order):** Chemistry Units 3&4 → Biology Units 3&4 → Chemistry Units 1&2 → English Units 3&4.
- **Users:** students (Year 11–12, **all under 18**), mentors (adults who teach and approve content), parents (adults who watch progress).
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
| `AI_MONTHLY_BUDGET_CENTS` | server only | no |

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
- `subjects` — code (e.g. `CHEM34`), name, current_study_design_version
- `source_documents` — subject_id, type (`study_design` | `examiner_report` | `past_exam` | `notes`), year, study_design_version, storage_path, status
- `chunks` — document_id, text, source_rank, study_design_version, is_current, objective_ids
- `objectives` — subject_id, unit, area_of_study, code, statement, dot_point_text, status (`draft` | `approved` | `retired`), approved_by
- `objective_prereqs` — objective_id, prereq_id
- `content_items` — objective_id, kind (`explanation` | `retrieval_q` | `worked_example` | `exam_q`), body (jsonb), source_chunk_ids, status (`draft` | `approved`)
- `attempts` — student_id, objective_id, content_item_id, activity, response, score, ai_feedback, created_at
- `mastery` — student_id, objective_id, score (0–4), last_practised_at, next_due_at
- `ai_usage` — user_id, purpose, model, input_tokens, output_tokens, cost_cents, created_at
- `safety_flags` — student_id, attempt_id, reason, created_at, reviewed_by, reviewed_at

---

## 5. Content rules

### 5.1 Source hierarchy (highest wins when sources disagree)
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
- VCAA study designs, exams and examiner reports are VCAA copyright. Keep them in **private** Supabase Storage for club members only.
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
- **Never commit:** `.env*` files with values, API keys, student data, or VCAA documents.
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
- V1 = Chemistry 3&4 only. Other subjects come after V1 works end to end.
- V1 retrieval by objective tag; pgvector/embeddings deferred.
- English 3&4 is skills-based (text response, argument analysis, writing), not knowledge dot points. It will need its own objective and grading design before we build it.
- **Public GitHub repo** (free branch protection + free Vercel collaboration). Because the code is public: no secrets, student data, real names or VCAA documents in the repo, ever.
- *(open)* What parents can see (summaries only vs full responses).
