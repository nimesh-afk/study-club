import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { UploadForm, type SubjectOption } from "./upload-form";

const typeLabel: Record<string, string> = {
  syllabus: "Curriculum",
  textbook: "Textbook",
  examiner_report: "Examiner report",
  past_exam: "Past exam",
  notes: "Notes",
};

const statusLabel: Record<string, string> = {
  uploaded: "Uploaded, text not extracted yet",
  extracted: "Text extracted",
  failed: "Extraction failed",
};

export default async function SourcesPage() {
  const profile = await requireRole(["mentor", "admin"]);

  // Mentor's own session: RLS lets mentors read subjects and documents.
  const supabase = await createClient();
  const [{ data: subjects }, { data: documents }] = await Promise.all([
    supabase.from("subjects").select("id, code, name").order("name"),
    supabase
      .from("source_documents")
      .select("id, title, type, status, created_at, subjects(name)")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor" className="text-sm text-zinc-600">
        ← Mentor area
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Source documents</h1>
      <p className="mt-1 text-zinc-600">
        Curriculum, textbook and notes. Stored privately for club members only; never share them
        outside the club.
      </p>

      <section className="mt-6 rounded-xl border border-zinc-200 p-4">
        <h2 className="mb-3 font-semibold">Upload a PDF</h2>
        <UploadForm subjects={(subjects ?? []) as SubjectOption[]} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Uploaded</h2>
        {!documents || documents.length === 0 ? (
          <p className="text-zinc-600">Nothing uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-col gap-0.5 px-4 py-3">
                <span className="font-medium">{d.title}</span>
                <span className="text-sm text-zinc-600">
                  {typeLabel[d.type] ?? d.type}
                  {" · "}
                  {(d.subjects as unknown as { name: string } | null)?.name}
                  {" · "}
                  {statusLabel[d.status] ?? d.status}
                  {" · "}
                  {new Date(d.created_at).toLocaleDateString("en-AU")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SignedInShell>
  );
}
