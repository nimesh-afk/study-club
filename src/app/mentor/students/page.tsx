import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { StudentProgress, type ProgressTopic } from "@/components/student-progress";
import type { Stage } from "@/lib/progress/stages";

// Mentors see their linked students; admins see every student (RLS decides).
export default async function MentorStudentsPage() {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();

  const { data: students } = await supabase
    .from("profiles")
    .select("id, display_name, year_level")
    .eq("role", "student")
    .order("display_name");
  const ids = (students ?? []).map((s) => s.id);

  const [{ data: subjects }, { data: topics }, { data: progress }, { data: attempts }] = await Promise.all([
    supabase.from("subjects").select("id, name").order("name"),
    supabase.from("objectives").select("id, subject_id, title, statement").eq("status", "approved").order("sort_order"),
    ids.length
      ? supabase.from("topic_progress").select("student_id, objective_id, stage").in("student_id", ids)
      : Promise.resolve({ data: [] as { student_id: string; objective_id: string; stage: string }[] }),
    ids.length
      ? supabase
          .from("checkpoint_attempts")
          .select("student_id, passed, marked_at")
          .in("student_id", ids)
          .not("marked_at", "is", null)
          .order("marked_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as { student_id: string; passed: boolean; marked_at: string }[] }),
  ]);

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor" className="text-sm text-zinc-600">
        ← Mentor area
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Students</h1>
      <p className="mt-1 text-zinc-600">
        {profile.role === "admin" ? "Every student." : "Students linked to you."} Notes waiting for a
        decision are on the{" "}
        <Link href="/mentor/notes" className="underline">
          notes page
        </Link>
        .
      </p>
      {(students ?? []).length === 0 && <p className="mt-6 text-zinc-600">No students yet.</p>}
      {(students ?? []).map((student) => {
        const mine = (attempts ?? []).filter((a) => a.student_id === student.id);
        const lastWeek = mine.filter((a) => Date.now() - new Date(a.marked_at).getTime() < 7 * 24 * 60 * 60 * 1000);
        return (
          <section key={student.id} className="mt-8 rounded-xl border border-zinc-200 p-4">
            <h2 className="text-lg font-semibold">
              {student.display_name}
              {student.year_level ? <span className="font-normal text-zinc-600"> · Year {student.year_level}</span> : null}
            </h2>
            <p className="text-sm text-zinc-600">
              Checkpoints in the last 7 days: {lastWeek.length} ({lastWeek.filter((a) => a.passed).length} passed)
              {mine[0] ? ` · last ${new Date(mine[0].marked_at).toLocaleDateString("en-AU")}` : ""}
            </p>
            <div className="mt-3">
              <StudentProgress
                subjects={subjects ?? []}
                topics={(topics ?? []) as ProgressTopic[]}
                stageOf={(topicId) =>
                  ((progress ?? []).find((p) => p.student_id === student.id && p.objective_id === topicId)?.stage ??
                    "locked") as Stage
                }
              />
            </div>
          </section>
        );
      })}
    </SignedInShell>
  );
}
