import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { STAGE_LABEL, canStartTopic, type Stage } from "@/lib/progress/stages";
import { STAGE_STYLE } from "@/components/student-progress";

type Topic = {
  id: string;
  subject_id: string;
  code: string;
  title: string | null;
  statement: string;
  locked: boolean;
  sort_order: number;
};

export default async function StudentHome() {
  const profile = await requireRole(["student"]);
  const supabase = await createClient();

  // RLS: students see every subject and only approved topics.
  const [{ data: subjects }, { data: topics }, { data: progress }] = await Promise.all([
    supabase.from("subjects").select("id, name").order("name"),
    supabase
      .from("objectives")
      .select("id, subject_id, code, title, statement, locked, sort_order")
      .eq("status", "approved")
      .order("sort_order"),
    supabase.from("topic_progress").select("objective_id, stage").eq("student_id", profile.id),
  ]);
  const stageOf = (id: string) =>
    ((progress ?? []).find((p) => p.objective_id === id)?.stage ?? "locked") as Stage;
  const allTopics = (topics ?? []) as Topic[];
  const withTopics = (subjects ?? []).filter((s) => allTopics.some((t) => t.subject_id === s.id));

  return (
    <SignedInShell profile={profile}>
      <h1 className="text-2xl font-semibold">Hi {profile.display_name}</h1>
      <p className="mt-2 text-zinc-600">
        Pick a topic. Step 1 is sending photos of your handwritten notes; then a short checkpoint
        quiz unlocks daily practice. Notes checks and marking are done by an AI, not a person.
      </p>

      {withTopics.length === 0 && <p className="mt-6 text-zinc-600">No topics are ready yet. Check back soon.</p>}

      {withTopics.map((subject) => {
        const subjectTopics = allTopics.filter((t) => t.subject_id === subject.id);
        return (
          <section key={subject.id} className="mt-8">
            <h2 className="mb-2 font-semibold">{subject.name}</h2>
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200">
              {subjectTopics.map((t) => {
                const stage = stageOf(t.id);
                const open = canStartTopic(t, subjectTopics, stageOf);
                return (
                  <li key={t.id}>
                    <Link href={`/student/topics/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50">
                      <span className={open || stage !== "locked" ? "" : "text-zinc-400"}>{t.title ?? t.statement}</span>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[stage]}`}>
                        {stage === "locked" && !open ? "Later" : STAGE_LABEL[stage]}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </SignedInShell>
  );
}
