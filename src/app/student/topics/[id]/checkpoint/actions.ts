"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_PAUSED_MESSAGE } from "@/lib/ai/budget";
import { markAttempt, openOrStartAttempt } from "@/lib/checkpoint/service";
import { reached, type Stage } from "@/lib/progress/stages";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CheckpointState = { message: string; isError: boolean };

// The student's stage for an approved topic (student session: RLS).
async function stageFor(studentId: string, topicId: string): Promise<Stage | null> {
  const supabase = await createClient();
  const { data: topic } = await supabase
    .from("objectives")
    .select("id")
    .eq("id", topicId)
    .eq("status", "approved")
    .maybeSingle();
  if (!topic) return null;
  const { data: progress } = await supabase
    .from("topic_progress")
    .select("stage")
    .eq("student_id", studentId)
    .eq("objective_id", topicId)
    .maybeSingle();
  return (progress?.stage ?? "locked") as Stage;
}

// Starts a checkpoint (or reopens the unfinished one) and shows it.
export async function startCheckpoint(formData: FormData): Promise<void> {
  const profile = await requireRole(["student"]);
  const topicId = String(formData.get("objective_id") ?? "");
  if (!UUID.test(topicId)) return;
  const stage = await stageFor(profile.id, topicId);
  if (!stage || !reached(stage, "notes_in")) redirect(`/student/topics/${topicId}`);
  const attemptId = await openOrStartAttempt(createAdminClient(), profile.id, topicId);
  redirect(`/student/topics/${topicId}/checkpoint${attemptId ? "" : "?notready=1"}`);
}

// Marks the student's answers and shows the results.
export async function submitCheckpoint(
  _previous: CheckpointState,
  formData: FormData,
): Promise<CheckpointState> {
  const profile = await requireRole(["student"]);
  const attemptId = String(formData.get("attempt_id") ?? "");
  const topicId = String(formData.get("objective_id") ?? "");
  if (!UUID.test(attemptId) || !UUID.test(topicId)) return { message: "Quiz not found.", isError: true };

  const responses = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("q_") && typeof value === "string") responses.set(key.slice(2), value);
  }

  const result = await markAttempt({ admin: createAdminClient(), attemptId, studentId: profile.id, responses });
  if (!result.ok)
    return {
      message: result.paused ? AI_PAUSED_MESSAGE : "Marking didn't work this time. Your answers are still here: please submit again.",
      isError: true,
    };

  revalidatePath(`/student/topics/${topicId}`);
  revalidatePath("/student");
  redirect(`/student/topics/${topicId}/checkpoint?attempt=${attemptId}${result.concern ? "&care=1" : ""}`);
}
