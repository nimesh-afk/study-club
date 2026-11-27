import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { STAGE_LABEL, canStartTopic, type Stage } from "@/lib/progress/stages";
import type { NotesAiResult } from "@/lib/notes/service";
import { NotesUpload } from "./notes-upload";

// The AI notes check can take up to a minute.
export const maxDuration = 120;

const coverMark = { yes: "✓", partly: "½", no: "✗" } as const;
const coverStyle = { yes: "text-green-700", partly: "text-amber-700", no: "text-red-700" } as const;

export default async function StudentTopicPage(props: PageProps<"/student/topics/[id]">) {
  const profile = await requireRole(["student"]);
  const { id } = await props.params;
  const supabase = await createClient();

  // RLS: students only see approved topics.
  const { data: topic } = await supabase
    .from("objectives")
    .select("id, subject_id, code, title, statement, key_points, locked, sort_order, subjects(name)")
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();
  if (!topic) notFound();

  const [{ data: subjectTopics }, { data: progress }, { data: submissions }] = await Promise.all([
    supabase.from("objectives").select("id, sort_order").eq("subject_id", topic.subject_id).eq("status", "approved"),
    supabase.from("topic_progress").select("objective_id, stage").eq("student_id", profile.id),
    supabase
      .from("notes_submissions")
      .select("id, status, ai_result, decided_by, created_at")
      .eq("student_id", profile.id)
      .eq("objective_id", topic.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const stageOf = (topicId: string) =>
    ((progress ?? []).find((p) => p.objective_id === topicId)?.stage ?? "locked") as Stage;
  const stage = stageOf(topic.id);
  const open = canStartTopic(topic, subjectTopics ?? [], stageOf);
  const latest = submissions?.[0];
  const result = latest?.ai_result as NotesAiResult | null | undefined;
  const subjectName = (topic.subjects as unknown as { name: string } | null)?.name;
  const keyPoints = (topic.key_points as string[] | null) ?? [];

  return (
    <SignedInShell profile={profile}>
      <Link href="/student" className="text-sm text-zinc-600">
        ← My topics
      </Link>
      <p className="mt-2 text-sm text-zinc-600">{subjectName}</p>
      <h1 className="text-2xl font-semibold">{topic.title ?? topic.statement}</h1>
      {topic.title && <p className="mt-1 text-zinc-700">{topic.statement}</p>}
      <p className="mt-2 text-sm">
        Stage: <strong>{STAGE_LABEL[stage]}</strong>
      </p>

      <section className="mt-6">
        <h2 className="font-semibold">What your notes need to cover</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {keyPoints.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ol>
      </section>

      {stage === "locked" && !open && (
        <p className="mt-6 rounded-lg bg-zinc-50 p-4 text-sm">
          This topic opens once you&apos;ve passed the checkpoints of the earlier topics.
        </p>
      )}

      {stage === "locked" && open && (
        <section className="mt-6 rounded-xl border border-zinc-200 p-4">
          <h2 className="font-semibold">Step 1: send your notes</h2>
          <p className="mt-1 mb-3 text-sm text-zinc-600">
            Write notes on this topic by hand, in your own words, then photograph them. Your notes
            are checked by an AI, not a person, and a mentor can change its decision.
          </p>
          <NotesUpload studentId={profile.id} objectiveId={topic.id} />
        </section>
      )}

      {stage !== "locked" && (
        <section className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-medium">Your notes are in.</p>
          <p className="mt-1">Next: the checkpoint quiz for this topic (coming soon).</p>
        </section>
      )}

      {latest && (latest.status === "needs_more" || latest.status === "accepted") && result && (
        <section className="mt-6 rounded-xl border border-zinc-200 p-4">
          <h2 className="font-semibold">
            Last check{latest.decided_by === "mentor" ? " (a mentor has reviewed this)" : " (by the AI)"}
          </h2>
          {!result.readable && <p className="mt-2 text-sm text-red-700">The photos were hard to read. Try brighter, sharper photos.</p>}
          {result.feedback && <p className="mt-2 text-sm">{result.feedback}</p>}
          <ul className="mt-3 space-y-1 text-sm">
            {result.key_points.map((k) => (
              <li key={k.point} className="flex gap-2">
                <span className={`w-4 shrink-0 font-bold ${coverStyle[k.covered]}`}>{coverMark[k.covered]}</span>
                <span>{k.point}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </SignedInShell>
  );
}
