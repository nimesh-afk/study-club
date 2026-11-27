import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { ExtractQuestionsForm } from "./extract-form";
import { approveAllQuestions, changeQuestion } from "./actions";

// AI extraction of a whole paper can take a few minutes. 300 s is the Vercel Hobby maximum.
export const maxDuration = 300;

type Question = {
  id: string;
  objective_id: string | null;
  source_ref: string | null;
  kind: "mcq" | "numeric" | "short" | "extended";
  stem: string;
  marks: number | null;
  needs_figure: boolean;
  answer: { ai_suggested?: boolean; correct_option?: string; value?: number; unit?: string };
  status: "draft" | "approved" | "retired";
  source_documents: { title: string } | null;
};

const STATUSES = ["draft", "approved", "retired"] as const;
const kindLabel = { mcq: "Multiple choice", numeric: "Numeric", short: "Short answer", extended: "Extended" };
const statusStyle = {
  draft: "bg-amber-100 text-amber-900",
  approved: "bg-green-100 text-green-900",
  retired: "bg-zinc-100 text-zinc-600",
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function QuestionsPage(props: PageProps<"/mentor/questions">) {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  const params = await props.searchParams;
  const status = (STATUSES as readonly string[]).includes(one(params.status) ?? "")
    ? (one(params.status) as Question["status"])
    : "draft";
  const topicFilter = one(params.topic) ?? "";

  const { data: subjects } = await supabase.from("subjects").select("id, code, name").order("name");
  const subject =
    (subjects ?? []).find((s) => s.code === one(params.subject)) ?? (subjects ?? [])[0] ?? null;
  if (!subject) {
    return (
      <SignedInShell profile={profile}>
        <p>No subjects yet.</p>
      </SignedInShell>
    );
  }

  const [{ data: topics }, { data: papers }, { data: counts }] = await Promise.all([
    supabase
      .from("objectives")
      .select("id, code, title, statement")
      .eq("subject_id", subject.id)
      .neq("status", "retired")
      .order("sort_order"),
    supabase
      .from("source_documents")
      .select("id, title, type, status, questions(count)")
      .eq("subject_id", subject.id)
      .in("type", ["past_exam", "examiner_report"])
      .order("created_at", { ascending: false }),
    supabase.from("questions").select("status").eq("subject_id", subject.id),
  ]);

  let query = supabase
    .from("questions")
    .select(
      "id, objective_id, source_ref, kind, stem, marks, needs_figure, answer, status, source_documents(title)",
    )
    .eq("subject_id", subject.id)
    .eq("status", status)
    .order("source_document_id")
    .order("source_seq")
    .limit(200);
  if (topicFilter === "none") query = query.is("objective_id", null);
  else if (topicFilter) query = query.eq("objective_id", topicFilter);
  const { data: rows } = await query;
  const questions = (rows ?? []) as unknown as Question[];

  const topicList = topics ?? [];
  const topicName = new Map(topicList.map((t) => [t.id, `${t.code} ${t.title ?? t.statement}`]));
  const countOf = (s: string) => (counts ?? []).filter((c) => c.status === s).length;
  const exams = (papers ?? []).filter((p) => p.type === "past_exam");
  const answerOptions = (papers ?? [])
    .filter((p) => p.status === "extracted")
    .map((p) => ({ id: p.id, title: p.title }));
  const draftsWithTopic = questions.filter((q) => q.status === "draft" && q.objective_id).length;
  const here = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ subject: subject.code, status, ...(topicFilter ? { topic: topicFilter } : {}), ...extra });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/mentor/questions?${p.toString()}`;
  };

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor" className="text-sm text-zinc-600">
        ← Mentor area
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Question bank</h1>

      <nav className="mt-3 flex flex-wrap gap-2" aria-label="Subjects">
        {(subjects ?? []).map((s) => (
          <Link
            key={s.id}
            href={`/mentor/questions?subject=${s.code}`}
            className={`rounded-full border px-3 py-1 text-sm ${
              s.id === subject.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700"
            }`}
          >
            {s.name}
          </Link>
        ))}
      </nav>

      <section className="mt-6 rounded-xl border border-zinc-200 p-4">
        <h2 className="font-semibold">Papers</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Upload tests and past exams (and their marking guides or examiner reports) on the{" "}
          <Link href="/mentor/sources" className="underline">
            Source documents
          </Link>{" "}
          page and extract their text. Then let the AI pull out the questions here. Roughly 50
          US cents to $1 per paper.
        </p>
        {exams.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">No past exams or tests uploaded for this subject yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200">
            {exams.map((p) => {
              const n = (p.questions as unknown as { count: number }[])[0]?.count ?? 0;
              return (
                <li key={p.id} className="py-3">
                  <p className="font-medium">{p.title}</p>
                  <p className="text-sm text-zinc-600">{n} questions so far</p>
                  {p.status === "extracted" ? (
                    <ExtractQuestionsForm
                      documentId={p.id}
                      answerOptions={answerOptions.map((o) => (o.id === p.id ? { ...o, title: `${o.title} (answers are in this paper)` } : o))}
                      hasQuestions={n > 0}
                    />
                  ) : (
                    <p className="text-sm text-amber-800">Extract its text on the Source documents page first.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav className="mt-8 flex flex-wrap gap-2" aria-label="Status">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={here({ status: s })}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              s === status ? "border-zinc-900 font-medium" : "border-zinc-200 text-zinc-600"
            }`}
          >
            {s[0].toUpperCase() + s.slice(1)} ({countOf(s)})
          </Link>
        ))}
      </nav>

      <form method="get" action="/mentor/questions" className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="subject" value={subject.code} />
        <input type="hidden" name="status" value={status} />
        <label className="flex flex-col gap-1 text-sm">
          Topic
          <select name="topic" defaultValue={topicFilter} className="rounded-lg border border-zinc-300 px-3 py-2 text-base">
            <option value="">All topics</option>
            <option value="none">No topic yet</option>
            {topicList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} {t.title ?? t.statement}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">Show</button>
      </form>

      {status === "draft" && draftsWithTopic > 0 && (
        <form action={approveAllQuestions} className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <input type="hidden" name="subject_id" value={subject.id} />
          <input type="hidden" name="objective_id" value={topicFilter === "none" ? "" : topicFilter} />
          <p className="mb-3 text-sm">
            Check the drafts below first, especially answers marked <strong>AI-suggested</strong>.
            Questions without a topic can&apos;t be approved until you choose one.
          </p>
          <button className="rounded-lg bg-green-700 px-4 py-2.5 font-medium text-white">
            Approve all drafts with a topic{topicFilter && topicFilter !== "none" ? " (this topic)" : ""}
          </button>
        </form>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {questions.length === 0 && <li className="text-zinc-600">No {status} questions here.</li>}
        {questions.map((q) => (
          <li key={q.id} className="rounded-xl border border-zinc-200 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyle[q.status]}`}>{q.status}</span>
              <span className="text-zinc-600">
                {q.source_documents?.title} · {q.source_ref ?? "?"} · {kindLabel[q.kind]}
                {q.marks ? ` · ${q.marks} mark${q.marks > 1 ? "s" : ""}` : ""}
              </span>
              {q.answer.ai_suggested && (
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900">AI-suggested answer</span>
              )}
              {q.needs_figure && (
                <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">needs figure</span>
              )}
            </div>
            <p className="mt-2 line-clamp-4 whitespace-pre-line">{q.stem}</p>
            <form action={changeQuestion} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={q.id} />
              <input type="hidden" name="action" value="topic" />
              <select
                name="objective_id"
                defaultValue={q.objective_id ?? ""}
                className="max-w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                aria-label="Topic"
              >
                <option value="">No topic</option>
                {topicList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {topicName.get(t.id)}
                  </option>
                ))}
              </select>
              <button className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm">Set topic</button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/mentor/questions/${q.id}`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium"
              >
                View / edit
              </Link>
              {q.status === "draft" && q.objective_id && (
                <form action={changeQuestion}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="action" value="approve" />
                  <button className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white">Approve</button>
                </form>
              )}
              {q.status === "draft" && (
                <form action={changeQuestion}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="action" value="delete" />
                  <button className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-800">Delete</button>
                </form>
              )}
              {q.status === "approved" && (
                <form action={changeQuestion}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="action" value="retire" />
                  <button className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">Retire</button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
      {questions.length === 200 && <p className="mt-3 text-sm text-zinc-600">Showing the first 200. Pick a topic to see more.</p>}
    </SignedInShell>
  );
}
