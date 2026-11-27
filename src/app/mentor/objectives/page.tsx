import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { ProposeButton } from "./propose-button";
import { ApproveAllButton } from "./approve-all-button";

// The AI proposal can take a couple of minutes. 300 s is the Vercel Hobby maximum.
export const maxDuration = 300;

type Topic = {
  id: string;
  code: string;
  unit: string | null;
  area_of_study: string;
  title: string | null;
  statement: string;
  key_points: string[];
  locked: boolean;
  status: "draft" | "approved" | "retired";
};

const statusStyle: Record<Topic["status"], string> = {
  draft: "bg-amber-100 text-amber-900",
  approved: "bg-green-100 text-green-900",
  retired: "bg-zinc-100 text-zinc-600",
};

// Groups topics by unit and area of study / strand, keeping their order.
function groupTopics(topics: Topic[]) {
  const groups: { label: string; topics: Topic[] }[] = [];
  for (const t of topics) {
    const label = [t.unit, t.area_of_study].filter(Boolean).join(" · ");
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.topics.push(t);
    else groups.push({ label, topics: [t] });
  }
  return groups;
}

export default async function TopicsPage(props: PageProps<"/mentor/objectives">) {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  const { subject: wanted } = await props.searchParams;

  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, code, name, level_label, grouping_label")
    .order("name");
  const subject =
    (subjects ?? []).find((s) => s.code === wanted) ?? (subjects ?? [])[0] ?? null;

  const { data: topics } = subject
    ? await supabase
        .from("objectives")
        .select("id, code, unit, area_of_study, title, statement, key_points, locked, status")
        .eq("subject_id", subject.id)
        .order("sort_order")
    : { data: [] };

  const list = (topics ?? []) as Topic[];
  const drafts = list.filter((t) => t.status === "draft").length;
  const approved = list.filter((t) => t.status === "approved").length;

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor" className="text-sm text-zinc-600">
        ← Mentor area
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Topics</h1>

      <nav className="mt-3 flex flex-wrap gap-2" aria-label="Subjects">
        {(subjects ?? []).map((s) => (
          <Link
            key={s.id}
            href={`/mentor/objectives?subject=${s.code}`}
            className={`rounded-full border px-3 py-1 text-sm ${
              s.id === subject?.id
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 text-zinc-700"
            }`}
          >
            {s.name}
          </Link>
        ))}
      </nav>

      <p className="mt-3 text-zinc-600">
        {subject ? `${subject.name}${subject.level_label ? ` (${subject.level_label})` : ""}` : "No subject"}{" "}
        · {list.length} topics ({approved} approved, {drafts} draft). Students only ever see approved
        topics.
      </p>

      {subject && (
        <section className="mt-6 rounded-xl border border-zinc-200 p-4">
          <ProposeButton subjectId={subject.id} hasDrafts={drafts > 0} />
        </section>
      )}

      {subject && drafts > 0 && (
        <section className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="mb-3 text-sm">
            Read through the drafts below and fix anything wrong (click one to edit it). Check that
            each topic&apos;s key points are right: they&apos;re used to check students&apos; notes
            and to sort questions. When they look right, approve them all at once. This is a
            once-a-year job.
          </p>
          <ApproveAllButton subjectId={subject.id} count={drafts} />
        </section>
      )}

      {groupTopics(list).map((group) => (
        <section key={group.label} className="mt-8">
          <h2 className="mb-2 font-semibold">{group.label}</h2>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200">
            {group.topics.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/mentor/objectives/${t.id}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-zinc-50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-zinc-600">{t.code}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyle[t.status]}`}>
                      {t.status}
                    </span>
                    {t.locked && (
                      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                        in order
                      </span>
                    )}
                  </div>
                  <span className="font-medium">{t.title ?? t.statement}</span>
                  {t.title && <span className="text-sm text-zinc-700">{t.statement}</span>}
                  <span className="text-sm text-zinc-500">{t.key_points.length} key points</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SignedInShell>
  );
}
