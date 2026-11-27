"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { askClaudeJson, AiAnswerError } from "@/lib/ai/client";
import { AI_PAUSED_MESSAGE, AiPausedError } from "@/lib/ai/budget";
import {
  PROPOSED_TOPICS_SCHEMA,
  PROPOSE_TOPICS_INSTRUCTIONS,
  TOPIC_TARGET,
  buildProposeTopicsPrompt,
  cleanTopic,
  nextTopicCodes,
  type ProposedTopics,
} from "@/lib/ai/prompts/propose-topics";

export type ProposeState = { message: string; isError: boolean };

// A full VCE study design (Units 1–4) is about 100,000–150,000 characters.
// 200,000 characters is roughly 50,000 tokens: about 10 US cents of input.
const MAX_CURRICULUM_CHARS = 200_000;

function fail(message: string): ProposeState {
  return { message, isError: true };
}

// Asks Claude (main model) to propose 10–20 draft topics with key points from
// the curriculum. Replaces earlier DRAFT topics only: approved and retired
// topics are never touched. Mentors only. Uses the mentor's own session.
export async function proposeTopics(
  _previous: ProposeState,
  formData: FormData,
): Promise<ProposeState> {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();

  const { data: subject } = await supabase
    .from("subjects")
    .select("id, code, name, level_label, grouping_label, scope_note, curriculum_code_prefix")
    .eq("id", String(formData.get("subject_id") ?? ""))
    .maybeSingle();
  if (!subject) return fail("Subject not found.");

  // 1. Curriculum text (rank 1 source, current version only: CLAUDE.md 5.2).
  // Mentor session: RLS lets mentors read chunks.
  const chunksOf = (type: string, columns: string) =>
    supabase
      .from("chunks")
      .select(`${columns}, source_documents!inner(type, subject_id, status)`)
      .eq("source_documents.subject_id", subject.id)
      .eq("source_documents.status", "extracted")
      .eq("source_documents.type", type)
      .eq("is_current", true)
      .order("seq");

  const { data: syllabus, error: syllabusError } = await chunksOf("syllabus", "text");
  if (syllabusError) return fail("Couldn't read the curriculum.");
  if (!syllabus || syllabus.length === 0)
    return fail("Upload the curriculum or study design PDF (type: Curriculum) and extract its text first.");

  let curriculumParts = (syllabus as unknown as { text: string }[]).map((r) => r.text);
  // A big multi-level curriculum file: keep only the parts with this level's codes.
  if (curriculumParts.join("\n").length > MAX_CURRICULUM_CHARS && subject.curriculum_code_prefix) {
    const prefix = subject.curriculum_code_prefix;
    curriculumParts = curriculumParts.filter((t) => t.includes(prefix));
  }
  const curriculumText = curriculumParts.join("\n\n");
  if (!curriculumText) return fail("No curriculum text found for this subject.");
  if (curriculumText.length > MAX_CURRICULUM_CHARS)
    return fail("The curriculum text is too long. Upload just the part for this subject and level.");

  // 2. Textbook section headings, if there is a textbook (headings only).
  const { data: textbookHeadings } = await chunksOf("textbook", "heading");
  const sectionHeadings = [
    ...new Set(
      ((textbookHeadings ?? []) as unknown as { heading: string | null }[])
        .map((r) => r.heading ?? "")
        .filter((h) => /^\d{1,2}[A-Z] /.test(h))
        .map((h) => h.replace(/ \(part \d+\)$/, "")),
    ),
  ];

  // 3. Ask Claude.
  let proposal: ProposedTopics;
  try {
    proposal = await askClaudeJson<ProposedTopics>(
      {
        purpose: "propose_topics",
        tier: "main",
        user: { id: profile.id, role: profile.role },
        instructions: PROPOSE_TOPICS_INSTRUCTIONS,
        prompt: buildProposeTopicsPrompt({
          subjectName: subject.name,
          levelLabel: subject.level_label,
          groupingLabel: subject.grouping_label,
          scopeNote: subject.scope_note,
          curriculumText,
          sectionHeadings,
        }),
        maxTokens: 16_000,
      },
      PROPOSED_TOPICS_SCHEMA,
    );
  } catch (error) {
    if (error instanceof AiPausedError) return fail(AI_PAUSED_MESSAGE);
    if (error instanceof AiAnswerError) return fail(`${error.message} Please try again.`);
    return fail("The AI request failed. Please try again.");
  }

  // 4. Check what came back.
  const topics = proposal.topics
    .map(cleanTopic)
    .filter((t) => t !== null)
    .slice(0, 30);
  if (topics.length === 0) return fail("The AI didn't return any usable topics.");

  // 5. Replace old drafts; approved/retired topics keep their codes.
  const { error: deleteError } = await supabase
    .from("objectives")
    .delete()
    .eq("subject_id", subject.id)
    .eq("status", "draft");
  if (deleteError) return fail("Couldn't clear the old drafts.");

  const { data: kept } = await supabase
    .from("objectives")
    .select("code, sort_order")
    .eq("subject_id", subject.id);
  const codes = nextTopicCodes((kept ?? []).map((o) => o.code), topics.length);
  const start = Math.max(0, ...(kept ?? []).map((o) => o.sort_order));

  const rows = topics.map((t, i) => ({
    subject_id: subject.id,
    unit: t.unit || null,
    area_of_study: t.group,
    code: codes[i],
    title: t.title,
    statement: t.statement,
    key_points: t.key_points,
    sort_order: start + (i + 1) * 10,
    status: "draft" as const,
  }));
  const { error: insertError } = await supabase.from("objectives").insert(rows);
  if (insertError) return fail("Couldn't save the proposed topics.");

  revalidatePath("/mentor/objectives");
  const outside =
    rows.length < TOPIC_TARGET.min || rows.length > TOPIC_TARGET.max
      ? ` That's outside the usual ${TOPIC_TARGET.min}–${TOPIC_TARGET.max}: you may want to propose again.`
      : "";
  return {
    message: `Proposed ${rows.length} draft topics. Review them below.${outside}`,
    isError: false,
  };
}

// ---------------------------------------------------------------------------
// Mentor review (CLAUDE.md 5.4). Topics are set up once a year, so this is
// deliberately simple: edit, delete drafts, approve, retire. Mentor's own
// session: RLS decides what each mentor can change.
// ---------------------------------------------------------------------------

export type ReviewState = { message: string; isError: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Save one topic: title, statement, unit, group, key points (one per line), locked.
export async function saveTopic(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  await requireRole(["mentor", "admin"]);
  const supabase = await createClient();

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const statement = String(formData.get("statement") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const group = String(formData.get("group") ?? "").trim();
  const locked = formData.get("locked") === "on";
  const keyPoints = [
    ...new Set(
      String(formData.get("key_points") ?? "")
        .split("\n")
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];

  if (!UUID.test(id)) return { message: "Topic not found.", isError: true };
  if (title.length < 1 || title.length > 80)
    return { message: "The title must be 1 to 80 characters.", isError: true };
  if (statement.length < 1 || statement.length > 500)
    return { message: "The statement must be 1 to 500 characters.", isError: true };
  if (unit.length > 40) return { message: "The unit is too long.", isError: true };
  if (group.length < 1 || group.length > 200)
    return { message: "Please fill in the group (area of study or strand).", isError: true };
  if (keyPoints.length < 1 || keyPoints.length > 30)
    return { message: "Add 1 to 30 key points, one per line.", isError: true };
  if (keyPoints.some((k) => k.length > 1000))
    return { message: "Each key point must be under 1,000 characters.", isError: true };

  const { data, error } = await supabase
    .from("objectives")
    .update({
      title,
      statement,
      unit: unit || null,
      area_of_study: group,
      key_points: keyPoints,
      locked,
    })
    .eq("id", id)
    .select("id");
  if (error || !data || data.length === 0)
    return { message: "Couldn't save the changes.", isError: true };

  revalidatePath("/mentor/objectives");
  return { message: "Saved.", isError: false };
}

// Approve, retire or delete one topic. Deleting only works on drafts
// (enforced by RLS too); approved topics are retired instead.
export async function changeObjectiveStatus(formData: FormData): Promise<void> {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("action") ?? "");
  if (!UUID.test(id)) return;

  if (action === "approve") {
    await supabase
      .from("objectives")
      .update({ status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft");
  } else if (action === "retire") {
    await supabase.from("objectives").update({ status: "retired" }).eq("id", id).eq("status", "approved");
  } else if (action === "delete") {
    const { data: topic } = await supabase
      .from("objectives")
      .select("subjects(code)")
      .eq("id", id)
      .maybeSingle();
    const code = (topic?.subjects as unknown as { code: string } | null)?.code;
    await supabase.from("objectives").delete().eq("id", id).eq("status", "draft");
    revalidatePath("/mentor/objectives");
    redirect(code ? `/mentor/objectives?subject=${code}` : "/mentor/objectives");
  }
  revalidatePath("/mentor/objectives");
}

// Approve every draft topic of a subject at once, after a mentor has read them.
export async function approveAllDrafts(formData: FormData): Promise<void> {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();
  const subjectId = String(formData.get("subject_id") ?? "");
  if (!UUID.test(subjectId)) return;
  await supabase
    .from("objectives")
    .update({ status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() })
    .eq("subject_id", subjectId)
    .eq("status", "draft");
  revalidatePath("/mentor/objectives");
}
