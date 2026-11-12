import { requireRole } from "@/lib/auth";
import { SignedInShell } from "@/components/signed-in-shell";

export default async function ParentHome() {
  const profile = await requireRole(["parent"]);
  return (
    <SignedInShell profile={profile}>
      <h1 className="text-2xl font-semibold">Parent area</h1>
      <p className="mt-2 text-zinc-600">Your child&apos;s progress will appear here.</p>
    </SignedInShell>
  );
}
