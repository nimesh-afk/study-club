// Server-side helpers for "who is logged in, and what are they allowed to see?".
// Always use these in pages; never trust anything the browser says about roles.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "student" | "mentor" | "parent" | "admin";

export type Profile = {
  id: string;
  role: Role;
  display_name: string;
  year_level: number | null;
};

// Returns the logged-in user's id (or null) and their profile (or null if
// they have a login but no profile row yet). RLS means a user can only ever
// read their own profile here.
export async function getCurrentProfile(): Promise<{
  userId: string | null;
  profile: Profile | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;
  if (!userId) return { userId: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, display_name, year_level")
    .eq("id", userId)
    .maybeSingle();

  return { userId, profile: (profile as Profile | null) ?? null };
}

// Where each role lands after logging in. Admins use the mentor area.
export function homeFor(role: Role): string {
  switch (role) {
    case "student":
      return "/student";
    case "parent":
      return "/parent";
    case "mentor":
    case "admin":
      return "/mentor";
  }
}

// Use at the top of every protected page. Sends logged-out visitors to
// /login and people with the wrong role to their own home page.
export async function requireRole(allowed: Role[]): Promise<Profile> {
  const { userId, profile } = await getCurrentProfile();
  if (!userId) redirect("/login");
  if (!profile) redirect("/account-not-ready");
  if (!allowed.includes(profile.role)) redirect(homeFor(profile.role));
  return profile;
}
