// Server-only jobs for notes submissions (CLAUDE.md 1 step 1, 6.1).
// Stages and AI results must be trustworthy, so they're written with the
// admin client after the caller has been checked (students can't write
// topic_progress or notes_submissions through the API: see the migration).
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeJson, AiAnswerError } from "@/lib/ai/client";
import { AiPausedError } from "@/lib/ai/budget";
import {
  CHECK_NOTES_INSTRUCTIONS,
  NOTES_CHECK_SCHEMA,
  buildCheckNotesPrompt,
  type NotesCheck,
} from "@/lib/ai/prompts/check-notes";
import { NOTES_PHOTO_DAYS, matchCoverage, notesPass, type CoverageItem } from "./decide";
import type { Stage } from "@/lib/progress/stages";

export type NotesAiResult = {
  is_study_notes: boolean;
  readable: boolean;
  key_points: CoverageItem[];
  feedback: string;
};

type Admin = ReturnType<typeof createAdminClient>;

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// Moves a student's topic to "notes_in" (if it hasn't gone further), or back to
// "locked" when a mentor rejects notes before the checkpoint.
export async function setNotesStage(
  admin: Admin,
  studentId: string,
  objectiveId: string,
  accepted: boolean,
) {
  const { data: current } = await admin
    .from("topic_progress")
    .select("stage")
    .eq("student_id", studentId)
    .eq("objective_id", objectiveId)
    .maybeSingle();
  const stage = (current?.stage ?? "locked") as Stage;

  if (accepted && stage === "locked") {
    await admin.from("topic_progress").upsert({
      student_id: studentId,
      objective_id: objectiveId,
      stage: "notes_in",
      notes_accepted_at: new Date().toISOString(),
    });
  } else if (!accepted && stage === "notes_in") {
    await admin
      .from("topic_progress")
      .update({ stage: "locked", notes_accepted_at: null })
      .eq("student_id", studentId)
      .eq("objective_id", objectiveId);
  }
}

// Runs the AI check on a submission that's already recorded as "checking".
// Returns the final status.
export async function checkSubmission(input: {
  admin: Admin;
  submissionId: string;
  student: { id: string };
  topic: { id: string; title: string; keyPoints: string[] };
  photoPaths: string[];
}): Promise<{ status: "accepted" | "needs_more" | "failed"; paused?: boolean }> {
  const { admin, submissionId, student, topic, photoPaths } = input;
  try {
    const images = await Promise.all(
      photoPaths.map(async (path) => {
        const { data, error } = await admin.storage.from("notes").download(path);
        if (error || !data) throw new Error("photo download failed");
        const mediaType = (data.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";
        return { mediaType, base64: bytesToBase64(new Uint8Array(await data.arrayBuffer())) };
      }),
    );

    const reply = await askClaudeJson<NotesCheck>(
      {
        purpose: "check_notes",
        tier: "main",
        user: { id: student.id, role: "student" },
        instructions: CHECK_NOTES_INSTRUCTIONS,
        prompt: buildCheckNotesPrompt(topic),
        images,
        maxTokens: 2000,
      },
      NOTES_CHECK_SCHEMA,
    );

    const items = matchCoverage(topic.keyPoints, reply.key_points);
    const accepted = notesPass({
      isStudyNotes: reply.is_study_notes,
      readable: reply.readable,
      items,
    });
    const result: NotesAiResult = {
      is_study_notes: reply.is_study_notes,
      readable: reply.readable,
      key_points: items,
      feedback: reply.feedback.trim().slice(0, 600),
    };
    const status = accepted ? "accepted" : "needs_more";
    await admin
      .from("notes_submissions")
      .update({
        status,
        ai_result: result,
        decided_by: "ai",
        decided_at: new Date().toISOString(),
      })
      .eq("id", submissionId);
    await setNotesStage(admin, student.id, topic.id, accepted);
    return { status };
  } catch (error) {
    await admin
      .from("notes_submissions")
      .update({ status: "failed", decided_at: new Date().toISOString() })
      .eq("id", submissionId);
    // Log only that it failed, never the notes or the AI's reply (CLAUDE.md 6.1).
    if (!(error instanceof AiPausedError) && !(error instanceof AiAnswerError))
      console.error("notes check failed");
    return { status: "failed", paused: error instanceof AiPausedError };
  }
}

// Deletes notes photos 30 days after a decision (CLAUDE.md 6.1). Cheap; runs
// whenever notes are submitted or decided, so no scheduled job is needed.
export async function deleteOldNotesPhotos(admin: Admin) {
  const cutoff = new Date(Date.now() - NOTES_PHOTO_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: old } = await admin
    .from("notes_submissions")
    .select("id, photo_paths")
    .is("photos_deleted_at", null)
    .not("decided_at", "is", null)
    .lt("decided_at", cutoff)
    .limit(50);
  for (const row of old ?? []) {
    const { error } = await admin.storage.from("notes").remove(row.photo_paths as string[]);
    if (!error)
      await admin
        .from("notes_submissions")
        .update({ photos_deleted_at: new Date().toISOString() })
        .eq("id", row.id);
  }
}
