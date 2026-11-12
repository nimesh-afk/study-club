import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { STRANDS } from "@/lib/ai/prompts/propose-objectives";
import { ProposeButton } from "./propose-button";
import { ApproveAllButton } from "./approve-all-button";

// The AI proposal can take a couple of minutes. 300 s is the Vercel Hobby maximum.
export const maxDuration = 300;

type Objective = {
  id: string;
  code: string;
  area_of_study: string;
  statement: string;
  status: "draft" | "approved" | "retired";
};

const statusStyle: Record<Objective["status"], string> = {
  draft: "bg-amber-100 text-amber-900",
  approved: "bg-green-100 text-green-900",
  retired: "bg-zinc-100 text-zinc-600",
};

export default async function ObjectivesPage() {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();

  // V1 has one subject: Year 8 Mathematics.
  const { data: subject } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("code", "MATH8")
    .maybeSingle();

  const [{ data: objectives }, { data: prereqs }] = subject
    ? await Promise.all([
        supabase
          .from("objectives")
          .select("id, code, area_of_study, statement, status")
          .eq("subject_id", subject.id)
          .order("sort_order"),
        supabase.from("objective_prereqs").select("objective_id, prereq_id"),
      ])
    : [{ data: [] }, { data: [] }];

  const list = (objectives ?? []) as Objective[];
  const codeById = new Map(list.map((o) => [o.id, o.code]));
  const prereqCodes = (id: string) =>
    (prereqs ?? [])
      .filter((p) => p.objective_id === id)
      .map((p) => codeById.get(p.prereq_id))
      .filter(Boolean)
      .join(", ");
  const drafts = list.filter((o) => o.status === "draft").length;
  const approved = list.filter((o) => o.status === "approved").length;

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor" className="text-sm text-zinc-600">
        ← Mentor area
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Objectives</h1>
      <p className="mt-1 text-zinc-600">
        {subject?.name ?? "No subject"} · {list.length} objectives ({approved} approved, {drafts}{" "}
        draft). Students only ever see approved objectives.
      </p>

      {subject && (
        <section className="mt-6 rounded-xl border border-zinc-200 p-4">
          <ProposeButton subjectId={subject.id} hasDrafts={drafts > 0} />
        </section>
      )}

      {subject && drafts > 0 && (
        <section className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="mb-3 text-sm">
            Read through the drafts below and fix anything wrong (click one to edit it). When
            they look right, approve them all at once. This is a once-a-year job.
          </p>
          <ApproveAllButton subjectId={subject.id} count={drafts} />
        </section>
      )}

      {STRANDS.map((strand) => {
        const inStrand = list.filter((o) => o.area_of_study === strand);
        if (inStrand.length === 0) return null;
        return (
          <section key={strand} className="mt-8">
            <h2 className="mb-2 font-semibold">{strand}</h2>
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200">
              {inStrand.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/mentor/objectives/${o.id}`}
                    className="flex flex-col gap-1 px-4 py-3 hover:bg-zinc-50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-zinc-600">{o.code}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyle[o.status]}`}>
                        {o.status}
                      </span>
                    </div>
                    <span>{o.statement}</span>
                    {prereqCodes(o.id) && (
                      <span className="text-sm text-zinc-600">Needs first: {prereqCodes(o.id)}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </SignedInShell>
  );
}
