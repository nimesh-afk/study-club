import { requireRole } from "@/lib/auth";
import { SignedInShell } from "@/components/signed-in-shell";

export default async function MentorHome() {
  const profile = await requireRole(["mentor", "admin"]);
  return (
    <SignedInShell profile={profile}>
      <h1 className="text-2xl font-semibold">Mentor area</h1>
      <p className="mt-2 text-zinc-600">
        Uploads, objective maps and student progress will appear here.
      </p>
    </SignedInShell>
  );
}
