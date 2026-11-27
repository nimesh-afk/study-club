import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { changeObjectiveStatus } from "../actions";
import { EditForm } from "./edit-form";
import { DeleteDraftButton } from "./delete-draft-button";

export default async function EditTopicPage(props: PageProps<"/mentor/objectives/[id]">) {
  const profile = await requireRole(["mentor", "admin"]);
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: topic } = await supabase
    .from("objectives")
    .select(
      "id, subject_id, code, unit, area_of_study, title, statement, key_points, locked, status, approved_at, subjects(code, name, grouping_label)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!topic) notFound();
  const subject = topic.subjects as unknown as { code: string; name: string; grouping_label: string };

  // Existing groups in this subject, offered as suggestions in the form.
  const { data: siblings } = await supabase
    .from("objectives")
    .select("area_of_study")
    .eq("subject_id", topic.subject_id);
  const groups = [...new Set((siblings ?? []).map((s) => s.area_of_study))];

  return (
    <SignedInShell profile={profile}>
      <Link href={`/mentor/objectives?subject=${subject.code}`} className="text-sm text-zinc-600">
        ← All {subject.name} topics
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        <span className="font-mono text-zinc-600">{topic.code}</span> {topic.title ?? ""}
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        Status: <strong>{topic.status}</strong>
        {topic.approved_at &&
          ` · approved ${new Date(topic.approved_at).toLocaleDateString("en-AU")}`}
      </p>

      <section className="mt-6">
        <EditForm
          topic={{
            id,
            title: topic.title ?? "",
            statement: topic.statement,
            unit: topic.unit ?? "",
            group: topic.area_of_study,
            keyPoints: topic.key_points ?? [],
            locked: topic.locked,
          }}
          groupingLabel={subject.grouping_label}
          groups={groups}
        />
      </section>

      <section className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-6">
        {topic.status === "draft" && (
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
        {topic.status === "approved" && (
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
