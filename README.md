# Study Club

An adaptive learning app for a small, private family study club preparing for VCE.

Mentors upload the curriculum and textbook, AI proposes learning objectives and content, and mentors approve everything before a student sees it. Students work through a loop of diagnose → teach → explain back → practise, and a mastery score (0–4) per objective decides what comes next. Students, mentors and parents each get their own dashboard.

**First subject:** Year 8 Mathematics (Victorian Curriculum 2.0, Level 8). VCE Chemistry, Biology and English come later.

**Access is invite-only.** There is no public sign-up, and no student data, secrets or copyrighted source documents are ever stored in this repo.

## Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript, Tailwind) on Vercel, Sydney region
- [Supabase](https://supabase.com) for Postgres, auth (email one-time codes) and private file storage, Sydney region
- [Claude API](https://docs.claude.com) for AI features, called from server code only

## Where to read more

- **[CLAUDE.md](CLAUDE.md)**: what the app is, how it's built, and the rules we follow (privacy, child safety, AI use, workflow). Start here.
- **[docs/ROADMAP.md](docs/ROADMAP.md)**: what's done and what's next.

## Running it locally

1. Copy `.env.example` to `.env.local` and fill in the values (ask Nimesh; never commit this file).
2. Install and start:

   ```bash
   npm install
   npm run dev
   ```

3. Open <http://localhost:3000>.

Before opening a pull request, run `npm run lint` and `npm run build`. Every change goes through a branch and pull request; see CLAUDE.md section 7.
