import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { StudentProgress, type ProgressTopic } from "@/components/student-progress";
import type { Stage } from "@/lib/progress/stages";

// Parents see a progress summary for each linked child (CLAUDE.md 6.2):
// topic stages only, not notes photos or answers.
export default async function ParentHome() {
  const profile = await requireRole(["parent"]);
  const supabase = await createClient();

  // RLS: a parent sees their own links, their linked children's profiles and progress.
  const { data: links } = await supabase
    .from("student_links")
    .select("student_id")
    .eq("linked_user_id", profile.id)
    .eq("relationship", "parent");
  const childIds = (links ?? []).map((l) => l.student_id);

  const [{ data: children }, { data: subjects }, { data: topics }, { data: progress }] = await Promise.all([
    childIds.length
      ? supabase.from("profiles").select("id, display_name, year_level").in("id", childIds).order("display_name")
      : Promise.resolve({ data: [] as { id: string; display_name: string; year_level: number | null }[] }),
    supabase.from("subjects").select("id, name").order("name"),
    supabase
      .from("objectives")
      .select("id, subject_id, title, statement")
      .eq("status", "approved")
      .order("sort_order"),
    childIds.length
      ? supabase.from("topic_progress").select("student_id, objective_id, stage").in("student_id", childIds)
      : Promise.resolve({ data: [] as { student_id: string; objective_id: string; stage: string }[] }),
  ]);

  return (
    <SignedInShell profile={profile}>
      <h1 className="text-2xl font-semibold">Parent area</h1>
      <p className="mt-2 text-zinc-600">
        Each topic goes: notes in → checkpoint passed → practising → secure. You see progress, not
        your child&apos;s notes or answers.
      </p>
      {(children ?? []).length === 0 && <p className="mt-6 text-zinc-600">No children are linked to your account yet.</p>}
      {(children ?? []).map((child) => (
        <section key={child.id} className="mt-8 rounded-xl border border-zinc-200 p-4">
          <h2 className="text-lg font-semibold">
            {child.display_name}
            {child.year_level ? <span className="font-normal text-zinc-600"> · Year {child.year_level}</span> : null}
          </h2>
          <div className="mt-3">
            <StudentProgress
              subjects={subjects ?? []}
              topics={(topics ?? []) as ProgressTopic[]}
              stageOf={(topicId) =>
                ((progress ?? []).find((p) => p.student_id === child.id && p.objective_id === topicId)?.stage ??
                  "locked") as Stage
              }
            />
          </div>
        </section>
      ))}
    </SignedInShell>
  );
}
