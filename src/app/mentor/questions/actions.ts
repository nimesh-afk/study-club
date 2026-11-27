"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { askClaudeJson, AiAnswerError } from "@/lib/ai/client";
import { AI_PAUSED_MESSAGE, AiPausedError } from "@/lib/ai/budget";
import {
  EXTRACTED_BATCH_SCHEMA,
  EXTRACT_QUESTIONS_INSTRUCTIONS,
  buildExtractPrompt,
  toQuestionDraft,
  type ExtractedBatch,
  type QuestionDraft,
} from "@/lib/ai/prompts/extract-questions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNKS_PER_BATCH = 2; // about 6 pages of the paper per AI call
const PARALLEL_CALLS = 3;
const MAX_ANSWERS_CHARS = 120_000; // about 30,000 tokens

export type ExtractState = { message: string; isError: boolean };

type ChunkRow = { seq: number; page_start: number | null; page_end: number | null; text: string };

// Runs `work` on every item, at most `limit` at a time, keeping the order.
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// AI reads one uploaded test or past exam (plus its marking guide or examiner
// report, if chosen) and saves every question part as a DRAFT. Running it again
// replaces this paper's drafts; approved and retired questions stay.
// Mentors only. Uses the mentor's own session (RLS: mentors read chunks and
// write questions).
export async function extractQuestions(
  _previous: ExtractState,
  formData: FormData,
): Promise<ExtractState> {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  const documentId = String(formData.get("document_id") ?? "");
  const answersId = String(formData.get("answers_document_id") ?? "");
  if (!UUID.test(documentId)) return { message: "Paper not found.", isError: true };

  const { data: doc } = await supabase
    .from("source_documents")
    .select("id, title, type, status, study_design_version, subject_id, subjects(name)")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.type !== "past_exam") return { message: "Paper not found.", isError: true };
  if (doc.status !== "extracted")
    return { message: "Extract the paper's text first (Source documents page).", isError: true };
  const subjectName = (doc.subjects as unknown as { name: string } | null)?.name ?? "";

  // Topics (approved first; drafts are fine before the map is approved).
  const { data: topicRows } = await supabase
    .from("objectives")
    .select("id, code, title, statement, key_points")
    .eq("subject_id", doc.subject_id)
    .neq("status", "retired")
    .order("sort_order");
  const topics = (topicRows ?? []).map((t) => ({
    id: t.id as string,
    code: t.code as string,
    title: (t.title as string | null) ?? (t.statement as string),
    keyPoints: (t.key_points as string[] | null) ?? [],
  }));
  if (topics.length === 0)
    return { message: "Set up this subject's topics first (Topics page).", isError: true };
  const topicIdByCode = new Map(topics.map((t) => [t.code, t.id]));

  // The paper, in order.
  const { data: paperChunks } = await supabase
    .from("chunks")
    .select("seq, page_start, page_end, text")
    .eq("document_id", doc.id)
    .order("seq");
  const chunks = (paperChunks ?? []) as ChunkRow[];
  if (chunks.length === 0) return { message: "No text found in this paper.", isError: true };

  // The marking guide or examiner report, if one was chosen.
  let answersText = "";
  if (UUID.test(answersId)) {
    const { data: answerDoc } = await supabase
      .from("source_documents")
      .select("id, subject_id, status")
      .eq("id", answersId)
      .maybeSingle();
    if (!answerDoc || answerDoc.subject_id !== doc.subject_id || answerDoc.status !== "extracted")
      return { message: "The chosen answers document isn't ready (extract its text first).", isError: true };
    const { data: answerChunks } = await supabase
      .from("chunks")
      .select("text")
      .eq("document_id", answersId)
      .order("seq");
    answersText = (answerChunks ?? []).map((c) => c.text).join("\n\n").slice(0, MAX_ANSWERS_CHARS);
  }

  // Ask Claude, a few pages at a time.
  const batches: ChunkRow[][] = [];
  for (let i = 0; i < chunks.length; i += CHUNKS_PER_BATCH)
    batches.push(chunks.slice(i, i + CHUNKS_PER_BATCH));

  let paused = false;
  const results = await inBatches(batches, PARALLEL_CALLS, async (batch) => {
    if (paused) return null;
    const last = batch[batch.length - 1];
    const following = chunks.find((c) => c.seq > last.seq)?.text ?? "";
    try {
      const reply = await askClaudeJson<ExtractedBatch>(
        {
          purpose: "extract_questions",
          tier: "main",
          user: { id: profile.id, role: profile.role },
          instructions: EXTRACT_QUESTIONS_INSTRUCTIONS,
          prompt: buildExtractPrompt({
            subjectName,
            topics,
            paperTitle: doc.title,
            pages: batch.map((c) => ({
              pageStart: c.page_start ?? 0,
              pageEnd: c.page_end ?? c.page_start ?? 0,
              text: c.text,
            })),
            followingPages: following,
            answersText,
          }),
          maxTokens: 16_000,
        },
        EXTRACTED_BATCH_SCHEMA,
      );
      return reply.questions;
    } catch (error) {
      if (error instanceof AiPausedError) paused = true;
      else if (!(error instanceof AiAnswerError)) console.error("question extraction batch failed");
      return null;
    }
  });

  if (paused && results.every((r) => r === null)) return { message: AI_PAUSED_MESSAGE, isError: true };
  const failed = results.filter((r) => r === null).length;

  const drafts: QuestionDraft[] = [];
  const seen = new Set<string>();
  for (const q of results.flatMap((r) => r ?? [])) {
    const draft = toQuestionDraft(q);
    if (!draft) continue;
    const key = `${draft.source_ref}|${draft.stem.slice(0, 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push(draft);
  }
  if (drafts.length === 0)
    return { message: "The AI didn't find any usable questions. Please try again.", isError: true };

  // Replace this paper's earlier drafts.
  const { error: deleteError } = await supabase
    .from("questions")
    .delete()
    .eq("source_document_id", doc.id)
    .eq("status", "draft");
  if (deleteError) return { message: "Couldn't clear this paper's old drafts.", isError: true };

  const rows = drafts.map((d, i) => ({
    subject_id: doc.subject_id,
    objective_id: topicIdByCode.get(d.topic_code) ?? null,
    source_document_id: doc.id,
    source_ref: d.source_ref,
    source_seq: i + 1,
    kind: d.kind,
    context: d.context,
    stem: d.stem,
    options: d.options,
    answer: d.answer,
    marks: d.marks,
    needs_figure: d.needs_figure,
    figure_page: d.figure_page,
    study_design_version: doc.study_design_version,
    status: "draft" as const,
  }));
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from("questions").insert(rows.slice(i, i + 50));
    if (error) return { message: "Couldn't save the extracted questions.", isError: true };
  }

  revalidatePath("/mentor/questions");
  const untagged = rows.filter((r) => !r.objective_id).length;
  return {
    message:
      `Saved ${rows.length} draft questions.` +
      (untagged ? ` ${untagged} need a topic chosen.` : "") +
      (failed
        ? ` ${failed} of ${batches.length} parts of the paper failed: extract again to retry.`
        : ""),
    isError: false,
  };
}

// ---------------------------------------------------------------------------
// Mentor review (CLAUDE.md 5.3, 5.4).
// ---------------------------------------------------------------------------

// Approve, retire or delete one question; or change its topic.
export async function changeQuestion(formData: FormData): Promise<void> {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("action") ?? "");
  const back = String(formData.get("back") ?? "/mentor/questions");
  if (!UUID.test(id)) return;

  if (action === "approve") {
    await supabase
      .from("questions")
      .update({ status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .not("objective_id", "is", null);
  } else if (action === "retire") {
    await supabase.from("questions").update({ status: "retired" }).eq("id", id).eq("status", "approved");
  } else if (action === "delete") {
    await supabase.from("questions").delete().eq("id", id).eq("status", "draft");
  } else if (action === "topic") {
    const topicId = String(formData.get("objective_id") ?? "");
    await supabase
      .from("questions")
      .update({ objective_id: UUID.test(topicId) ? topicId : null })
      .eq("id", id);
  }
  revalidatePath("/mentor/questions");
  if (action === "delete" && back.startsWith("/mentor/questions")) redirect(back);
}

// Approve every draft of a subject (optionally one topic) that has a topic.
export async function approveAllQuestions(formData: FormData): Promise<void> {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  const subjectId = String(formData.get("subject_id") ?? "");
  const topicId = String(formData.get("objective_id") ?? "");
  if (!UUID.test(subjectId)) return;
  let query = supabase
    .from("questions")
    .update({ status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() })
    .eq("subject_id", subjectId)
    .eq("status", "draft")
    .not("objective_id", "is", null);
  if (UUID.test(topicId)) query = query.eq("objective_id", topicId);
  await query;
  revalidatePath("/mentor/questions");
}

export type SaveState = { message: string; isError: boolean };

// Save edits to one question. Options are one per line, "A. text".
export async function saveQuestion(_previous: SaveState, formData: FormData): Promise<SaveState> {
  await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { message: "Question not found.", isError: true };

  const kind = String(formData.get("kind") ?? "");
  const stem = String(formData.get("stem") ?? "").trim();
  const context = String(formData.get("context") ?? "").trim();
  const marksRaw = Number(formData.get("marks") ?? "");
  const marks = Number.isInteger(marksRaw) && marksRaw >= 1 && marksRaw <= 30 ? marksRaw : null;
  const topicId = String(formData.get("objective_id") ?? "");
  const modelAnswer = String(formData.get("model_answer") ?? "").trim();
  const markingPoints = String(formData.get("marking_points") ?? "")
    .split("\n")
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 20);
  const needsFigure = formData.get("needs_figure") === "on";

  if (!["mcq", "numeric", "short", "extended"].includes(kind))
    return { message: "Choose a question type.", isError: true };
  if (!stem || stem.length > 6000) return { message: "The question must be 1 to 6,000 characters.", isError: true };
  if (context.length > 6000) return { message: "The shared context is too long.", isError: true };

  let options: { label: string; text: string }[] | null = null;
  let answer: Record<string, unknown>;
  if (kind === "mcq") {
    options = String(formData.get("options") ?? "")
      .split("\n")
      .map((line) => line.trim().match(/^([A-Za-z])[.)]\s*(.+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ label: m[1].toUpperCase(), text: m[2].trim() }));
    const correct = String(formData.get("correct_option") ?? "").trim().toUpperCase();
    if (options.length < 2)
      return { message: 'Add at least two options, one per line, like "A. text".', isError: true };
    if (!options.some((o) => o.label === correct))
      return { message: "The correct option must be one of the option letters.", isError: true };
    answer = { correct_option: correct };
  } else if (kind === "numeric") {
    const value = Number(String(formData.get("value") ?? "").trim());
    const tolerance = Number(formData.get("tolerance_pct") ?? 2);
    if (!Number.isFinite(value)) return { message: "Enter the answer as a number.", isError: true };
    answer = {
      value,
      unit: String(formData.get("unit") ?? "").trim(),
      tolerance_pct: Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 20 ? tolerance : 2,
      model_answer: modelAnswer,
      marking_points: markingPoints,
    };
  } else {
    if (!modelAnswer && markingPoints.length === 0)
      return { message: "Add a model answer or marking points.", isError: true };
    answer = { model_answer: modelAnswer, marking_points: markingPoints };
  }

  const { data, error } = await supabase
    .from("questions")
    .update({
      kind,
      stem,
      context: context || null,
      options,
      answer,
      marks,
      needs_figure: needsFigure,
      objective_id: UUID.test(topicId) ? topicId : null,
    })
    .eq("id", id)
    .select("id");
  if (error || !data || data.length === 0) return { message: "Couldn't save the changes.", isError: true };

  revalidatePath("/mentor/questions");
  return { message: "Saved. (A mentor-edited answer no longer counts as AI-suggested.)", isError: false };
}
