import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignedInShell } from "@/components/signed-in-shell";
import { questionsForStudent, type AttemptResult } from "@/lib/checkpoint/service";
import { CHECKPOINT_MAX, CHECKPOINT_MIN } from "@/lib/checkpoint/rules";
import { reached, type Stage } from "@/lib/progress/stages";
import { startCheckpoint } from "./actions";
import { QuizForm } from "./quiz-form";

// Marking short answers with the AI can take a little while.
export const maxDuration = 60;

export default async function CheckpointPage(props: PageProps<"/student/topics/[id]/checkpoint">) {
  const profile = await requireRole(["student"]);
  const { id } = await props.params;
  const { attempt: attemptParam, notready, care } = await props.searchParams;
  const supabase = await createClient();

  // Student session (RLS): approved topic, own progress, own attempts.
  const { data: topic } = await supabase
    .from("objectives")
    .select("id, title, statement")
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();
  if (!topic) notFound();
  const { data: progress } = await supabase
    .from("topic_progress")
    .select("stage")
    .eq("student_id", profile.id)
    .eq("objective_id", id)
    .maybeSingle();
  const stage = (progress?.stage ?? "locked") as Stage;
  if (!reached(stage, "notes_in")) redirect(`/student/topics/${id}`);

  const { data: attempts } = await supabase
    .from("checkpoint_attempts")
    .select("id, status, question_ids, results, score, total, passed, created_at")
    .eq("student_id", profile.id)
    .eq("objective_id", id)
    .order("created_at", { ascending: false })
    .limit(10);
  const shown =
    (attempts ?? []).find((a) => a.id === attemptParam) ??
    (attempts ?? []).find((a) => a.status === "open") ??
    (reached(stage, "checkpoint_passed") ? (attempts ?? []).find((a) => a.passed) : undefined);
  const title = topic.title ?? topic.statement;

  // The questions of the attempt being shown (answers are NOT included).
  const admin = createAdminClient();
  const questions = shown ? await questionsForStudent(admin, shown.question_ids as string[]) : [];
  const questionById = new Map(questions.map((q) => [q.id, q]));

  return (
    <SignedInShell profile={profile}>
      <Link href={`/student/topics/${id}`} className="text-sm text-zinc-600">
        ← {title}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Checkpoint quiz</h1>
      <p className="mt-1 text-zinc-600">
        {CHECKPOINT_MIN}–{CHECKPOINT_MAX} questions on this topic. Get them all right to pass. Every
        try gives you new questions where possible, and you can try again straight away. Written
        answers are marked by an AI, not a person.
      </p>

      {care && (
        <section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">
          <p className="font-medium">Is everything OK?</p>
          <p className="mt-1">
            If something is worrying you, please talk to a parent, a mentor or another adult you
            trust. You can also call Kids Helpline on 1800 55 1800 (free, any time) or Lifeline on
            13 11 14. In an emergency, call 000.
          </p>
        </section>
      )}

      {notready && !shown && (
        <p className="mt-6 rounded-lg bg-zinc-50 p-4 text-sm">
          This topic doesn&apos;t have enough approved questions for a checkpoint yet. A mentor is
          adding more: check back soon.
        </p>
      )}

      {shown?.status === "open" && (
        <section className="mt-6">
          <QuizForm attemptId={shown.id} objectiveId={id} questions={questions} />
        </section>
      )}

      {shown?.status === "marked" && (
        <section className="mt-6">
          <div
            className={`rounded-xl p-4 ${shown.passed ? "border border-green-200 bg-green-50" : "border border-amber-200 bg-amber-50"}`}
          >
            <p className="text-lg font-semibold">
              {shown.score} / {shown.total} {shown.passed ? "· Passed!" : ""}
            </p>
            <p className="mt-1 text-sm">
              {shown.passed
                ? "Well done. These questions now go into your daily practice."
                : "Not yet. Read the answers below, then try a fresh set of questions."}
            </p>
          </div>
          <ol className="mt-4 flex flex-col gap-3">
            {((shown.results ?? []) as AttemptResult[]).map((r, i) => {
              const q = questionById.get(r.question_id);
              return (
                <li key={r.question_id} className="rounded-xl border border-zinc-200 p-4">
                  <p className="text-sm text-zinc-600">
                    Question {i + 1} · <span className={r.correct ? "text-green-700" : "text-red-700"}>{r.correct ? "Correct" : "Not quite"}</span>
                  </p>
                  {q && <p className="mt-1 whitespace-pre-line font-medium">{q.stem}</p>}
                  <p className="mt-2 text-sm">
                    <span className="text-zinc-600">Your answer:</span> {r.response || "(blank)"}
                  </p>
                  {!r.correct && (
                    <p className="mt-1 text-sm">
                      <span className="text-zinc-600">Answer:</span> {r.correct_answer}
                    </p>
                  )}
                  {r.feedback && <p className="mt-1 text-sm text-zinc-700">{r.feedback}</p>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {shown?.status !== "open" && !(shown?.passed) && (
        <form action={startCheckpoint} className="mt-6">
          <input type="hidden" name="objective_id" value={id} />
          <button className="rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white">
            {shown ? "Try a fresh set" : "Start the checkpoint"}
          </button>
        </form>
      )}

      {shown?.passed && (
        <Link href="/student" className="mt-6 inline-block rounded-lg border border-zinc-300 px-4 py-2.5 font-medium">
          Back to my topics
        </Link>
      )}
    </SignedInShell>
  );
}
