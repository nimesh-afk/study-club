import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import type { NotesAiResult } from "@/lib/notes/service";
import { decideNotes } from "./actions";

type Submission = {
  id: string;
  student_id: string;
  status: "checking" | "accepted" | "needs_more" | "failed";
  ai_result: NotesAiResult | null;
  decided_by: "ai" | "mentor" | null;
  photo_paths: string[];
  photos_deleted_at: string | null;
  created_at: string;
  objectives: { title: string | null; statement: string } | null;
};

const statusLabel = {
  checking: "Checking",
  accepted: "Accepted",
  needs_more: "Needs more",
  failed: "Check failed",
};
const statusStyle = {
  checking: "bg-zinc-100 text-zinc-700",
  accepted: "bg-green-100 text-green-900",
  needs_more: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-900",
};

export default async function MentorNotesPage() {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();

  // RLS: linked mentors and admins only.
  const { data: rows } = await supabase
    .from("notes_submissions")
    .select(
      "id, student_id, status, ai_result, decided_by, photo_paths, photos_deleted_at, created_at, objectives(title, statement)",
    )
    .order("created_at", { ascending: false })
    .limit(30);
  const submissions = (rows ?? []) as unknown as Submission[];

  const studentIds = [...new Set(submissions.map((s) => s.student_id))];
  const { data: people } = studentIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", studentIds)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));

  // Short-lived signed links to the photos (CLAUDE.md 2: private buckets, short expiry).
  const paths = submissions.filter((s) => !s.photos_deleted_at).flatMap((s) => s.photo_paths);
  const { data: signed } = paths.length
    ? await supabase.storage.from("notes").createSignedUrls(paths, 600)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor" className="text-sm text-zinc-600">
        ← Mentor area
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Students&apos; notes</h1>
      <p className="mt-1 text-zinc-600">
        The AI checks each set of notes against the topic&apos;s key points. You can change its
        decision. Photos are deleted 30 days after a decision.
      </p>

      <ul className="mt-6 flex flex-col gap-4">
        {submissions.length === 0 && <li className="text-zinc-600">No notes sent yet.</li>}
        {submissions.map((s) => (
          <li key={s.id} className="rounded-xl border border-zinc-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{nameOf.get(s.student_id) ?? "Student"}</span>
              <span className="text-zinc-600">· {s.objectives?.title ?? s.objectives?.statement}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyle[s.status]}`}>
                {statusLabel[s.status]}
                {s.decided_by === "mentor" ? " (mentor)" : s.decided_by === "ai" ? " (AI)" : ""}
              </span>
              <span className="text-sm text-zinc-500">{new Date(s.created_at).toLocaleString("en-AU")}</span>
            </div>

            {s.ai_result && (
              <div className="mt-2 text-sm">
                {s.ai_result.feedback && <p>{s.ai_result.feedback}</p>}
                <p className="mt-1 text-zinc-600">
                  Covered: {s.ai_result.key_points.filter((k) => k.covered === "yes").length} ·
                  partly: {s.ai_result.key_points.filter((k) => k.covered === "partly").length} ·
                  missing: {s.ai_result.key_points.filter((k) => k.covered === "no").length} (of{" "}
                  {s.ai_result.key_points.length})
                  {!s.ai_result.readable && " · hard to read"}
                  {!s.ai_result.is_study_notes && " · may not be study notes"}
                </p>
              </div>
            )}

            {s.photos_deleted_at ? (
              <p className="mt-2 text-sm text-zinc-500">Photos deleted.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {s.photo_paths.map((p, i) =>
                  urlOf.get(p) ? (
                    <a key={p} href={urlOf.get(p)} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                      <img src={urlOf.get(p)} alt={`Notes photo ${i + 1}`} className="h-28 w-auto rounded border border-zinc-200" />
                    </a>
                  ) : null,
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {s.status !== "accepted" && (
                <form action={decideNotes}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="decision" value="accept" />
                  <button className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white">Accept notes</button>
                </form>
              )}
              {s.status === "accepted" && (
                <form action={decideNotes}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <button className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">Not enough: ask for more</button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </SignedInShell>
  );
}
