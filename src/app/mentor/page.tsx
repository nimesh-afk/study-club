import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { SignedInShell } from "@/components/signed-in-shell";

export default async function MentorHome() {
  const profile = await requireRole(["mentor", "admin"]);
  return (
    <SignedInShell profile={profile}>
      <h1 className="text-2xl font-semibold">Mentor area</h1>
      <p className="mt-2 text-zinc-600">
        Source documents, topics, the question bank and student progress.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/mentor/sources"
          className="inline-block rounded-lg border border-zinc-300 px-4 py-2 font-medium"
        >
          Source documents →
        </Link>
        <Link
          href="/mentor/objectives"
          className="inline-block rounded-lg border border-zinc-300 px-4 py-2 font-medium"
        >
          Topics →
        </Link>
        <Link
          href="/mentor/questions"
          className="inline-block rounded-lg border border-zinc-300 px-4 py-2 font-medium"
        >
          Question bank →
        </Link>
        <Link
          href="/mentor/notes"
          className="inline-block rounded-lg border border-zinc-300 px-4 py-2 font-medium"
        >
          Students&apos; notes →
        </Link>
      </div>
      {profile.role === "admin" && (
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href="/mentor/people"
            className="inline-block rounded-lg border border-zinc-300 px-4 py-2 font-medium"
          >
            Manage people →
          </Link>
          <Link
            href="/mentor/ai-check"
            className="inline-block rounded-lg border border-zinc-300 px-4 py-2 font-medium"
          >
            AI check →
          </Link>
        </div>
      )}
    </SignedInShell>
  );
}
