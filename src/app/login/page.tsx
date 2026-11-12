import { redirect } from "next/navigation";
import { getCurrentProfile, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const { link } = await searchParams;
  // Already logged in? Go straight to your own area.
  const { profile } = await getCurrentProfile();
  if (profile) redirect(homeFor(profile.role));

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Study Club</h1>
        <p className="mt-1 text-zinc-600">Log in with the email you were invited with.</p>
      </div>
      {link === "invalid" && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          That sign-in link has expired or was opened in a different browser.
          Please ask for a new one below.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
