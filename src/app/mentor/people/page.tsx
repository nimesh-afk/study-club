import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignedInShell } from "@/components/signed-in-shell";
import { InviteForm, type PersonOption } from "./invite-form";

const roleLabel: Record<PersonOption["role"], string> = {
  student: "Student",
  parent: "Parent",
  mentor: "Mentor",
  admin: "Admin",
};

export default async function PeoplePage() {
  const profile = await requireRole(["admin"]);

  // Normal session: RLS lets an admin read every profile and link.
  const supabase = await createClient();
  const [{ data: people }, { data: links }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, role, year_level")
      .order("role")
      .order("display_name"),
    supabase.from("student_links").select("student_id, linked_user_id, relationship"),
  ]);

  const nameById = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  const linksFor = (id: string) =>
    (links ?? [])
      .filter((l) => l.student_id === id || l.linked_user_id === id)
      .map((l) =>
        l.student_id === id
          ? `${nameById.get(l.linked_user_id)} (${l.relationship})`
          : nameById.get(l.student_id),
      )
      .filter(Boolean)
      .join(", ");

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← Back to mentor area
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">People</h1>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Add a person</h2>
        <p className="mb-4 mt-1 text-sm text-zinc-600">
          Only people added here can log in. Add parents and mentors first, then
          students, so you can link them.
        </p>
        <InviteForm people={(people ?? []) as PersonOption[]} />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Members</h2>
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
          {(people ?? []).map((p) => (
            <li key={p.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:justify-between">
              <span className="font-medium">
                {p.display_name}
                {p.year_level ? <span className="text-zinc-500"> · Year {p.year_level}</span> : null}
              </span>
              <span className="text-sm text-zinc-600">
                {roleLabel[p.role as PersonOption["role"]]}
                {linksFor(p.id) ? ` · ${linksFor(p.id)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </SignedInShell>
  );
}
