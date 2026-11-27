// ADMIN Supabase client. Uses the SECRET key, which BYPASSES row-level security.
// Rules (CLAUDE.md 6.2):
//   * Server code only. Never import this from a Client Component.
//   * Only call it after checking who is asking (requireRole + ownership checks).
//   * Only for jobs a normal session can't do: creating people, linking them,
//     usage logging, and trusted results the API won't let users write
//     (topic stages, notes check results: src/lib/notes/service.ts).
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
