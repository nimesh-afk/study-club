import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { SignedInShell } from "@/components/signed-in-shell";
import { createClient } from "@/lib/supabase/server";
import { reviewSafetyFlag } from "./actions";

export default async function MentorHome() {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  // RLS: linked mentors and admins only.
  const { data: flags } = await supabase
    .from("safety_flags")
    .select("id, student_id, source, reason, created_at")
    .is("reviewed_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  const studentIds = [...new Set((flags ?? []).map((f) => f.student_id))];
  const { data: people } = studentIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", studentIds)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));

  return (
    <SignedInShell profile={profile}>
      <h1 className="text-2xl font-semibold">Mentor area</h1>
      {(flags ?? []).length > 0 && (
        <section className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-900">Please check in</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {(flags ?? []).map((f) => (
              <li key={f.id} className="text-sm">
                <p>
                  <strong>{nameOf.get(f.student_id) ?? "A student"}</strong> ·{" "}
                  {new Date(f.created_at).toLocaleString("en-AU")} · {f.source}
                </p>
                <p className="mt-1">{f.reason}</p>
                <form action={reviewSafetyFlag} className="mt-2">
                  <input type="hidden" name="id" value={f.id} />
                  <button className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm">
                    I&apos;ve followed this up
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
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
