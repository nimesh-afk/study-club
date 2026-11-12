import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile, homeFor } from "@/lib/auth";

export default async function Home() {
  // Logged-in people go straight to their own area.
  const { userId, profile } = await getCurrentProfile();
  if (profile) redirect(homeFor(profile.role));
  if (userId) redirect("/account-not-ready");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Study Club
      </h1>
      <p className="mt-4 max-w-md text-lg text-zinc-600">
        Adaptive VCE study for our family club. Members only.
      </p>
      <Link
        href="/login"
        className="mt-8 rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white"
      >
        Log in
      </Link>
    </main>
  );
}
