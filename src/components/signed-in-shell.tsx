import Link from "next/link";
import type { ReactNode } from "react";
import type { Profile } from "@/lib/auth";
import { signOut } from "@/lib/auth-actions";

const roleLabel: Record<Profile["role"], string> = {
  student: "Student",
  mentor: "Mentor",
  parent: "Parent",
  admin: "Admin",
};

// Header + page frame for everyone who is logged in.
export function SignedInShell({
  profile,
  children,
}: {
  profile: Profile;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <nav className="flex items-center gap-4">
          {/* "/" sends each person to their own home page. */}
          <Link href="/" className="font-semibold">
            Study Club
          </Link>
          {profile.role === "admin" && (
            <Link href="/mentor/people" className="text-sm text-zinc-600 hover:text-zinc-900">
              People
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-zinc-600">
            {profile.display_name} · {roleLabel[profile.role]}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
