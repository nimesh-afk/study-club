"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A mentor marks a safety flag as reviewed (CLAUDE.md 6.3). Mentor's own
// session: RLS allows linked mentors and admins, in their own name only.
export async function reviewSafetyFlag(formData: FormData): Promise<void> {
  const profile = await requireRole(["mentor", "admin"]);
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return;
  const supabase = await createClient();
  await supabase
    .from("safety_flags")
    .update({ reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .is("reviewed_at", null);
  revalidatePath("/mentor");
}
