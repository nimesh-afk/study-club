import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { changeQuestion } from "../actions";
import { QuestionForm, type QuestionFormValues } from "./question-form";

type Answer = {
  correct_option?: string;
  value?: number;
  unit?: string;
  tolerance_pct?: number;
  model_answer?: string;
  marking_points?: string[];
  ai_suggested?: boolean;
};

export default async function QuestionPage(props: PageProps<"/mentor/questions/[id]">) {
  const profile = await requireRole(["mentor", "admin"]);
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: q } = await supabase
    .from("questions")
    .select(
      "id, subject_id, objective_id, source_ref, kind, context, stem, options, answer, marks, needs_figure, figure_page, status, subjects(code), source_documents(title)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!q) notFound();

  const { data: topics } = await supabase
    .from("objectives")
    .select("id, code, title, statement")
    .eq("subject_id", q.subject_id)
    .neq("status", "retired")
    .order("sort_order");

  const subjectCode = (q.subjects as unknown as { code: string } | null)?.code ?? "";
  const paper = (q.source_documents as unknown as { title: string } | null)?.title;
  const answer = (q.answer ?? {}) as Answer;
  const options = (q.options ?? []) as { label: string; text: string }[];
  const back = `/mentor/questions?subject=${subjectCode}&status=${q.status}`;

  const values: QuestionFormValues = {
    id: q.id,
    kind: q.kind,
    context: q.context ?? "",
    stem: q.stem,
    options: options.map((o) => `${o.label}. ${o.text}`).join("\n"),
    correctOption: answer.correct_option ?? "",
    value: answer.value !== undefined ? String(answer.value) : "",
    unit: answer.unit ?? "",
    tolerancePct: String(answer.tolerance_pct ?? 2),
    modelAnswer: answer.model_answer ?? "",
    markingPoints: (answer.marking_points ?? []).join("\n"),
    marks: q.marks ? String(q.marks) : "",
    objectiveId: q.objective_id ?? "",
    needsFigure: q.needs_figure,
  };

  return (
    <SignedInShell profile={profile}>
      <Link href={back} className="text-sm text-zinc-600">
        ← Question bank
      </Link>
      <h1 className="mt-2 text-xl font-semibold">{q.source_ref ?? "Question"}</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {paper} · status <strong>{q.status}</strong>
      </p>
      {answer.ai_suggested && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">
          The answer below was worked out by the AI, not taken from a marking guide. Check it
          carefully; saving this form marks it as checked.
        </p>
      )}
      {q.needs_figure && (
        <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          This question needs a figure{q.figure_page ? ` (on page ${q.figure_page} of the paper)` : ""}.
          Figures can&apos;t be added yet, so students won&apos;t get this question until they can.
        </p>
      )}

      <section className="mt-6">
        <QuestionForm values={values} topics={topics ?? []} />
      </section>

      <section className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-6">
        {q.status === "draft" && q.objective_id && (
          <form action={changeQuestion}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="action" value="approve" />
            <button className="rounded-lg bg-green-700 px-4 py-2.5 font-medium text-white">Approve</button>
          </form>
        )}
        {q.status === "draft" && (
          <form action={changeQuestion}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="action" value="delete" />
            <input type="hidden" name="back" value={back} />
            <button className="rounded-lg border border-red-300 px-4 py-2.5 font-medium text-red-800">
              Delete draft
            </button>
          </form>
        )}
        {q.status === "approved" && (
          <form action={changeQuestion}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="action" value="retire" />
            <button className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium">
              Retire (students stop getting it)
            </button>
          </form>
        )}
      </section>
    </SignedInShell>
  );
}
