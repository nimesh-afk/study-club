"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_PAUSED_MESSAGE } from "@/lib/ai/budget";
import { MAX_NOTES_PHOTOS } from "@/lib/notes/decide";
import { checkSubmission, deleteOldNotesPhotos } from "@/lib/notes/service";
import { canStartTopic, type Stage } from "@/lib/progress/stages";

export type NotesState = { message: string; isError: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): NotesState {
  return { message, isError: true };
}

// Step 1 of the student flow (CLAUDE.md 1): the browser has already put the
// photos in the student's own folder of the private "notes" bucket. Check them,
// record the submission and let the AI check coverage of the key points.
export async function submitNotes(input: {
  objectiveId: string;
  photoPaths: string[];
}): Promise<NotesState> {
  const profile = await requireRole(["student"]);
  const supabase = await createClient();

  if (!UUID.test(input.objectiveId)) return fail("Topic not found.");
  const paths = [...new Set(input.photoPaths)];
  const pattern = new RegExp(
    `^${profile.id}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`,
  );
  if (paths.length < 1 || paths.length > MAX_NOTES_PHOTOS)
    return fail(`Add 1 to ${MAX_NOTES_PHOTOS} photos.`);
  if (!paths.every((p) => pattern.test(p))) return fail("Photo upload not recognised. Please try again.");

  // The topic must be approved (RLS: students only see approved topics) and open.
  const { data: topic } = await supabase
    .from("objectives")
    .select("id, subject_id, title, statement, key_points, locked, sort_order")
    .eq("id", input.objectiveId)
    .eq("status", "approved")
    .maybeSingle();
  if (!topic) return fail("Topic not found.");
  const keyPoints = (topic.key_points as string[] | null) ?? [];
  if (keyPoints.length === 0) return fail("This topic has no key points yet. Ask a mentor.");

  const [{ data: subjectTopics }, { data: progress }] = await Promise.all([
    supabase
      .from("objectives")
      .select("id, sort_order")
      .eq("subject_id", topic.subject_id)
      .eq("status", "approved"),
    supabase.from("topic_progress").select("objective_id, stage").eq("student_id", profile.id),
  ]);
  const stageOf = (id: string) =>
    ((progress ?? []).find((p) => p.objective_id === id)?.stage ?? "locked") as Stage;
  if (stageOf(topic.id) !== "locked") return fail("Your notes for this topic are already in.");
  if (!canStartTopic(topic, subjectTopics ?? [], stageOf))
    return fail("Finish the earlier topics' checkpoints first.");

  // Are the photos really in the student's folder? (Student session: RLS.)
  const { data: files } = await supabase.storage
    .from("notes")
    .list(profile.id, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  const present = new Set((files ?? []).map((f) => `${profile.id}/${f.name}`));
  if (!paths.every((p) => present.has(p))) return fail("Some photos didn't upload. Please try again.");

  // Record it, then check it. Written with the admin client: see src/lib/notes/service.ts.
  const admin = createAdminClient();
  const { data: submission, error } = await admin
    .from("notes_submissions")
    .insert({ student_id: profile.id, objective_id: topic.id, photo_paths: paths, status: "checking" })
    .select("id")
    .single();
  if (error || !submission) return fail("Couldn't save your notes. Please try again.");

  const result = await checkSubmission({
    admin,
    submissionId: submission.id,
    student: { id: profile.id },
    topic: { id: topic.id, title: topic.title ?? topic.statement, keyPoints },
    photoPaths: paths,
  });
  await deleteOldNotesPhotos(admin);

  revalidatePath(`/student/topics/${topic.id}`);
  revalidatePath("/student");
  if (result.status === "accepted")
    return { message: "Your notes cover this topic. Nice work! The checkpoint quiz is next.", isError: false };
  if (result.status === "needs_more")
    return { message: "Not quite yet: see what to add below, then send new photos.", isError: false };
  return fail(result.paused ? AI_PAUSED_MESSAGE : "The notes check didn't work this time. Please try again.");
}
