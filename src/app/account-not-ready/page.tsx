import { redirect } from "next/navigation";
import { getCurrentProfile, homeFor } from "@/lib/auth";
import { signOut } from "@/lib/auth-actions";

// Logged in, but no profile row yet (an admin hasn't finished setting them up).
export default async function AccountNotReady() {
  const { userId, profile } = await getCurrentProfile();
  if (!userId) redirect("/login");
  if (profile) redirect(homeFor(profile.role));

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Almost there</h1>
      <p className="text-zinc-600">
        Your account hasn&apos;t been set up yet. Please ask a mentor to finish
        setting it up.
      </p>
      <form action={signOut}>
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5">
          Sign out
        </button>
      </form>
    </main>
  );
}
