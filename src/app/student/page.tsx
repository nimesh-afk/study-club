import { requireRole } from "@/lib/auth";
import { SignedInShell } from "@/components/signed-in-shell";

export default async function StudentHome() {
  const profile = await requireRole(["student"]);
  return (
    <SignedInShell profile={profile}>
      <h1 className="text-2xl font-semibold">Hi {profile.display_name}</h1>
      <p className="mt-2 text-zinc-600">Your study plan will appear here.</p>
    </SignedInShell>
  );
}
