// ADMIN Supabase client. Uses the SECRET key, which BYPASSES row-level security.
// Rules (CLAUDE.md 6.2):
//   * Server code only. Never import this from a Client Component.
//   * Only call it after checking the user is an admin (requireRole(["admin"])).
//   * Only for jobs a normal session can't do: creating people, linking them.
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("The admin client must never run in the browser.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("Supabase admin environment variables are missing.");
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
