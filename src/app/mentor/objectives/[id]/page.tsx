import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { STRANDS } from "@/lib/ai/prompts/propose-objectives";
import { changeObjectiveStatus } from "../actions";
import { EditForm, type PrereqOption } from "./edit-form";
import { DeleteDraftButton } from "./delete-draft-button";

export default async function EditObjectivePage(props: PageProps<"/mentor/objectives/[id]">) {
  const profile = await requireRole(["mentor", "admin"]);
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: objective } = await supabase
    .from("objectives")
    .select("id, subject_id, code, area_of_study, statement, dot_point_text, status, approved_at")
    .eq("id", id)
    .maybeSingle();
  if (!objective) notFound();

  const [{ data: others }, { data: current }] = await Promise.all([
    supabase
      .from("objectives")
      .select("id, code, statement, area_of_study, status")
      .eq("subject_id", objective.subject_id)
      .neq("id", id)
      .neq("status", "retired")
      .order("sort_order"),
    supabase.from("objective_prereqs").select("prereq_id").eq("objective_id", id),
  ]);

  const options: PrereqOption[] = (others ?? []).map((o) => ({
    id: o.id,
    code: o.code,
    statement: o.statement,
    strand: o.area_of_study,
  }));

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor/objectives" className="text-sm text-zinc-600">
        ← All objectives
      </Link>
      <h1 className="mt-2 font-mono text-xl font-semibold">{objective.code}</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Status: <strong>{objective.status}</strong>
        {objective.approved_at &&
          ` · approved ${new Date(objective.approved_at).toLocaleDateString("en-AU")}`}
      </p>
      {objective.dot_point_text && (
        <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm">
          <span className="font-medium">Curriculum wording:</span> {objective.dot_point_text}
        </p>
      )}

      <section className="mt-6">
        <EditForm
          objective={{ id, statement: objective.statement, strand: objective.area_of_study }}
          strands={STRANDS}
          options={options}
          selected={(current ?? []).map((c) => c.prereq_id)}
        />
      </section>

      <section className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-6">
        {objective.status === "draft" && (
          <>
            <form action={changeObjectiveStatus}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="action" value="approve" />
              <button className="rounded-lg bg-green-700 px-4 py-2.5 font-medium text-white">
                Approve
              </button>
            </form>
            <DeleteDraftButton id={id} />
          </>
        )}
        {objective.status === "approved" && (
          <form action={changeObjectiveStatus}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value="retire" />
            <button className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium">
              Retire (hide from students, keep their progress)
            </button>
          </form>
        )}
      </section>
    </SignedInShell>
  );
}
