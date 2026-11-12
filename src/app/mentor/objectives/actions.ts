"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { askClaudeJson, AiAnswerError } from "@/lib/ai/client";
import { AI_PAUSED_MESSAGE, AiPausedError } from "@/lib/ai/budget";
import { curriculumCodes } from "@/lib/extraction/split";
import {
  PROPOSED_MAP_SCHEMA,
  PROPOSE_OBJECTIVES_INSTRUCTIONS,
  STRANDS,
  buildProposePrompt,
  cleanPrerequisites,
  type ProposedMap,
} from "@/lib/ai/prompts/propose-objectives";

export type ProposeState = { message: string; isError: boolean };

// Curriculum code prefix per subject, used to pick the right part of a big
// curriculum document (e.g. the F–10 file has every level).
const CODE_PREFIX: Record<string, string> = { MATH8: "VC2M8" };
const MAX_CURRICULUM_CHARS = 60_000; // ~15,000 tokens
const OBJECTIVE_CODE = /^[A-Z0-9]{4,20}(\.\d{1,2})?$/;

function fail(message: string): ProposeState {
  return { message, isError: true };
}

// Asks Claude (main model) to propose draft objectives and prerequisites from
// the curriculum. Replaces earlier DRAFT objectives only: approved and retired
// objectives are never touched. Mentors only. Uses the mentor's own session.
export async function proposeObjectives(
  _previous: ProposeState,
  formData: FormData,
): Promise<ProposeState> {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();

  const { data: subject } = await supabase
    .from("subjects")
    .select("id, code, current_study_design_version")
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
    return fail("Upload the curriculum PDF (type: Curriculum) and extract its text first.");

  let curriculumParts = (syllabus as unknown as { text: string }[]).map((r) => r.text);
  if (curriculumParts.join("\n").length > MAX_CURRICULUM_CHARS) {
    const prefix = CODE_PREFIX[subject.code];
    curriculumParts = prefix ? curriculumParts.filter((t) => t.includes(prefix)) : [];
  }
  const curriculumText = curriculumParts.join("\n\n");
  if (!curriculumText || curriculumText.length > MAX_CURRICULUM_CHARS)
    return fail("The curriculum text is too long. Upload just the Level 8 part.");

  // 2. Textbook section headings, and the curriculum codes on chapter openers.
  // Headings and codes only: no textbook passages go to the AI here.
  const { data: textbookHeadings } = await chunksOf("textbook", "heading");
  const { data: openers } = await chunksOf("textbook", "heading, text").like(
    "heading",
    "Chapter % opener%",
  );
  const sectionHeadings = [
    ...new Set(
      ((textbookHeadings ?? []) as unknown as { heading: string | null }[])
        .map((r) => r.heading ?? "")
        .filter((h) => /^\d{1,2}[A-Z] /.test(h))
        .map((h) => h.replace(/ \(part \d+\)$/, "")),
    ),
  ];
  const chapterCodes = ((openers ?? []) as unknown as { heading: string; text: string }[])
    .map((r) => ({ chapter: r.heading.replace(/ opener.*$/, ""), codes: curriculumCodes(r.text) }))
    .filter((c) => c.codes.length > 0);

  // 3. Ask Claude.
  let map: ProposedMap;
  try {
    map = await askClaudeJson<ProposedMap>(
      {
        purpose: "propose_objectives",
        tier: "main",
        user: { id: profile.id, role: profile.role },
        instructions: PROPOSE_OBJECTIVES_INSTRUCTIONS,
        prompt: buildProposePrompt({ curriculumText, sectionHeadings, chapterCodes }),
        maxTokens: 16_000,
      },
      PROPOSED_MAP_SCHEMA,
    );
  } catch (error) {
    if (error instanceof AiPausedError) return fail(AI_PAUSED_MESSAGE);
    if (error instanceof AiAnswerError) return fail(`${error.message} Please try again.`);
    return fail("The AI request failed. Please try again.");
  }

  // 4. Check what came back.
  const seen = new Set<string>();
  const objectives = map.objectives.filter((o) => {
    const ok =
      OBJECTIVE_CODE.test(o.code) &&
      !seen.has(o.code) &&
      (STRANDS as readonly string[]).includes(o.strand) &&
      o.statement.trim().length > 0 &&
      o.statement.length <= 500;
    seen.add(o.code);
    return ok;
  });
  if (objectives.length === 0) return fail("The AI didn't return any usable objectives.");

  // 5. Replace old drafts; keep codes already used by approved/retired objectives.
  const { error: deleteError } = await supabase
    .from("objectives")
    .delete()
    .eq("subject_id", subject.id)
    .eq("status", "draft");
  if (deleteError) return fail("Couldn't clear the old drafts.");

  const { data: kept } = await supabase
    .from("objectives")
    .select("id, code")
    .eq("subject_id", subject.id);
  const idByCode = new Map((kept ?? []).map((o) => [o.code, o.id]));

  const strandOrder = (s: string) => STRANDS.indexOf(s as (typeof STRANDS)[number]);
  const newRows = objectives
    .filter((o) => !idByCode.has(o.code))
    .sort((a, b) => strandOrder(a.strand) - strandOrder(b.strand) || a.code.localeCompare(b.code))
    .map((o, i) => ({
      subject_id: subject.id,
      area_of_study: o.strand,
      code: o.code,
      statement: o.statement.trim(),
      dot_point_text: o.curriculum_text.trim() || null,
      sort_order: (i + 1) * 10,
      status: "draft" as const,
    }));

  const { data: inserted, error: insertError } = await supabase
    .from("objectives")
    .insert(newRows)
    .select("id, code");
  if (insertError) return fail("Couldn't save the proposed objectives.");
  for (const o of inserted ?? []) idByCode.set(o.code, o.id);

  // 6. Prerequisites between the new drafts and anything already there.
  const prereqRows = cleanPrerequisites({ objectives, prerequisites: map.prerequisites })
    .filter((p) => idByCode.has(p.objective_code) && idByCode.has(p.prereq_code))
    .filter((p) => (inserted ?? []).some((o) => o.code === p.objective_code))
    .map((p) => ({
      objective_id: idByCode.get(p.objective_code)!,
      prereq_id: idByCode.get(p.prereq_code)!,
    }));
  if (prereqRows.length > 0) {
    const { error } = await supabase.from("objective_prereqs").insert(prereqRows);
    if (error) return fail("Objectives saved, but the prerequisites couldn't be saved.");
  }

  revalidatePath("/mentor/objectives");
  return {
    message: `Proposed ${newRows.length} draft objectives with ${prereqRows.length} prerequisite links. Review them below.`,
    isError: false,
  };
}
