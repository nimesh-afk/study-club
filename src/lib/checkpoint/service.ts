// Server-only checkpoint jobs (CLAUDE.md 1 step 2). Questions and answers are
// mentor-only in the database, so these use the admin client, always for one
// student who has already been checked (requireRole + topic stage).
// Answers are never sent to the browser before the student has answered.
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeJson, AiAnswerError } from "@/lib/ai/client";
import { AiPausedError } from "@/lib/ai/budget";
import {
  MARKED_ANSWERS_SCHEMA,
  MARK_ANSWERS_INSTRUCTIONS,
  buildMarkAnswersPrompt,
  type MarkedAnswer,
} from "@/lib/ai/prompts/mark-answers";
import { CHECKPOINT_KINDS, mcqCorrect, numericCorrect, pickCheckpoint } from "./rules";
import { reached, type Stage } from "@/lib/progress/stages";

type Admin = ReturnType<typeof createAdminClient>;

export type StudentQuestion = {
  id: string;
  kind: "mcq" | "numeric" | "short";
  context: string | null;
  stem: string;
  options: { label: string; text: string }[] | null;
  marks: number | null;
  unit: string | null;
};

export type AttemptResult = {
  question_id: string;
  response: string;
  correct: boolean;
  feedback: string;
  // Shown after marking:
  correct_answer: string;
};

type Answer = {
  correct_option?: string;
  value?: number;
  unit?: string;
  tolerance_pct?: number;
  model_answer?: string;
  marking_points?: string[];
};

// Approved, current questions of the topic that the checkpoint can use.
export async function eligibleQuestionIds(admin: Admin, topicId: string): Promise<string[]> {
  const { data } = await admin
    .from("questions")
    .select("id")
    .eq("objective_id", topicId)
    .eq("status", "approved")
    .eq("is_current", true)
    .eq("needs_figure", false)
    .in("kind", [...CHECKPOINT_KINDS]);
  return (data ?? []).map((q) => q.id as string);
}

// Returns the student's open attempt for this topic, or starts a new one.
// Null if the topic doesn't have enough questions yet.
export async function openOrStartAttempt(
  admin: Admin,
  studentId: string,
  topicId: string,
): Promise<string | null> {
  const { data: recent } = await admin
    .from("checkpoint_attempts")
    .select("id, status, question_ids")
    .eq("student_id", studentId)
    .eq("objective_id", topicId)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = recent?.[0];
  if (last?.status === "open") return last.id as string;

  const picked = pickCheckpoint(
    await eligibleQuestionIds(admin, topicId),
    (last?.question_ids as string[] | undefined) ?? [],
  );
  if (picked.length === 0) return null;
  const { data, error } = await admin
    .from("checkpoint_attempts")
    .insert({ student_id: studentId, objective_id: topicId, question_ids: picked })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id as string;
}

// The attempt's questions WITHOUT answers, in order.
export async function questionsForStudent(admin: Admin, questionIds: string[]): Promise<StudentQuestion[]> {
  const { data } = await admin
    .from("questions")
    .select("id, kind, context, stem, options, marks, answer")
    .in("id", questionIds);
  const byId = new Map((data ?? []).map((q) => [q.id as string, q]));
  return questionIds
    .map((id) => byId.get(id))
    .filter((q) => q !== undefined)
    .map((q) => ({
      id: q.id as string,
      kind: q.kind as StudentQuestion["kind"],
      context: (q.context as string | null) ?? null,
      stem: q.stem as string,
      options: (q.options as StudentQuestion["options"]) ?? null,
      marks: (q.marks as number | null) ?? null,
      // Only the unit is shown (so students know what to give), never the value.
      unit: q.kind === "numeric" ? ((q.answer as Answer).unit ?? null) || null : null,
    }));
}

function correctAnswerText(kind: string, answer: Answer): string {
  if (kind === "mcq") return `${answer.correct_option}`;
  if (kind === "numeric")
    return [`${answer.value}${answer.unit ? ` ${answer.unit}` : ""}`, answer.model_answer]
      .filter(Boolean)
      .join(". ");
  return answer.model_answer || (answer.marking_points ?? []).join("; ");
}

// Marks an open attempt. MCQ and numeric by code; short answers by the cheap
// AI model in one call. Saves the results, raises safety flags, and moves the
// topic to "checkpoint_passed" on 100%.
export async function markAttempt(input: {
  admin: Admin;
  attemptId: string;
  studentId: string;
  responses: Map<string, string>;
}): Promise<{ ok: true; passed: boolean; concern: boolean } | { ok: false; paused: boolean }> {
  const { admin, attemptId, studentId, responses } = input;
  const { data: attempt } = await admin
    .from("checkpoint_attempts")
    .select("id, student_id, objective_id, question_ids, status")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt || attempt.student_id !== studentId || attempt.status !== "open")
    return { ok: false, paused: false };

  const ids = attempt.question_ids as string[];
  const { data: rows } = await admin
    .from("questions")
    .select("id, kind, context, stem, answer")
    .in("id", ids);
  const byId = new Map((rows ?? []).map((q) => [q.id as string, q]));

  const results: AttemptResult[] = [];
  const written: { index: number; context: string | null; stem: string; answer: Answer; response: string }[] = [];
  for (const id of ids) {
    const q = byId.get(id);
    if (!q) continue;
    const answer = q.answer as Answer;
    const response = (responses.get(id) ?? "").trim().slice(0, 3000);
    const result: AttemptResult = {
      question_id: id,
      response,
      correct: false,
      feedback: "",
      correct_answer: correctAnswerText(q.kind as string, answer),
    };
    if (q.kind === "mcq") result.correct = mcqCorrect(answer.correct_option ?? "", response);
    else if (q.kind === "numeric")
      result.correct = numericCorrect(Number(answer.value), Number(answer.tolerance_pct ?? 2), response);
    else if (response)
      written.push({ index: results.length, context: q.context as string | null, stem: q.stem as string, answer, response });
    else result.feedback = "No answer given.";
    results.push(result);
  }

  let concern = false;
  if (written.length > 0) {
    try {
      const reply = await askClaudeJson<{ answers: MarkedAnswer[] }>(
        {
          purpose: "mark_checkpoint",
          tier: "cheap",
          user: { id: studentId, role: "student" },
          instructions: MARK_ANSWERS_INSTRUCTIONS,
          prompt: buildMarkAnswersPrompt(
            written.map((w) => ({
              context: w.context,
              stem: w.stem,
              modelAnswer: w.answer.model_answer ?? "",
              markingPoints: w.answer.marking_points ?? [],
              response: w.response,
            })),
          ),
          maxTokens: 3000,
        },
        MARKED_ANSWERS_SCHEMA,
      );
      written.forEach((w, i) => {
        const mark = reply.answers.find((a) => a.number === i + 1);
        results[w.index].correct = mark?.correct ?? false;
        results[w.index].feedback = (mark?.feedback ?? "").trim().slice(0, 400);
        if (mark?.concern) concern = true;
      });
    } catch (error) {
      if (!(error instanceof AiPausedError) && !(error instanceof AiAnswerError))
        console.error("checkpoint marking failed");
      // Leave the attempt open so the student can submit again.
      return { ok: false, paused: error instanceof AiPausedError };
    }
  }

  const score = results.filter((r) => r.correct).length;
  const passed = results.length > 0 && score === results.length;
  await admin
    .from("checkpoint_attempts")
    .update({
      status: "marked",
      results,
      score,
      total: results.length,
      passed,
      marked_at: new Date().toISOString(),
    })
    .eq("id", attempt.id);

  if (concern) {
    await admin.from("safety_flags").insert({
      student_id: studentId,
      source: "checkpoint",
      source_id: attempt.id,
      reason: "An answer in a checkpoint quiz may show distress. Please check in with the student.",
    });
  }

  if (passed) {
    const { data: progress } = await admin
      .from("topic_progress")
      .select("stage")
      .eq("student_id", studentId)
      .eq("objective_id", attempt.objective_id)
      .maybeSingle();
    const stage = (progress?.stage ?? "locked") as Stage;
    if (!reached(stage, "checkpoint_passed")) {
      await admin
        .from("topic_progress")
        .update({ stage: "checkpoint_passed", checkpoint_passed_at: new Date().toISOString() })
        .eq("student_id", studentId)
        .eq("objective_id", attempt.objective_id);
    }
  }
  return { ok: true, passed, concern };
}
