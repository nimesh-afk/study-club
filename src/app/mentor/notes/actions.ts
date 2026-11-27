"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteOldNotesPhotos, setNotesStage } from "@/lib/notes/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A mentor overrides the AI's notes decision (CLAUDE.md 1 step 1).
// The mentor's own session must be able to read the submission (RLS: linked
// mentors and admins only) before anything is changed.
export async function decideNotes(formData: FormData): Promise<void> {
  const profile = await requireRole(["mentor", "admin"]);
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!UUID.test(id) || !["accept", "reject"].includes(decision)) return;

  const supabase = await createClient();
  const { data: submission } = await supabase
    .from("notes_submissions")
    .select("id, student_id, objective_id")
    .eq("id", id)
    .maybeSingle();
  if (!submission) return;

  const accepted = decision === "accept";
  const admin = createAdminClient();
  await admin
    .from("notes_submissions")
    .update({
      status: accepted ? "accepted" : "needs_more",
      decided_by: "mentor",
      decided_by_user: profile.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", submission.id);
  await setNotesStage(admin, submission.student_id, submission.objective_id, accepted);
  await deleteOldNotesPhotos(admin);
  revalidatePath("/mentor/notes");
}
