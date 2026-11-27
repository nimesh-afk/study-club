// Prompt + JSON schema for "AI extracts questions from a test or past exam"
// (CLAUDE.md 5.3). The paper is sent a few pages at a time; the marking guide
// or examiner report (if any) and the subject's topics come with each batch.
// Output: draft questions. A mentor approves them later.

export type ExtractedQuestion = {
  ref: string;
  context: string;
  stem: string;
  kind: "mcq" | "numeric" | "short" | "extended";
  options: { label: string; text: string }[];
  correct_option: string;
  value: string;
  unit: string;
  model_answer: string;
  marking_points: string[];
  answer_source: "marking_guide" | "ai_suggested";
  marks: number;
  topic_code: string;
  needs_figure: boolean;
  figure_page: number;
};

export type ExtractedBatch = { questions: ExtractedQuestion[] };

// Structured output schema. Empty strings / 0 mean "not applicable", which
// keeps the schema simple (no optional fields).
export const EXTRACTED_BATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "ref",
          "context",
          "stem",
          "kind",
          "options",
          "correct_option",
          "value",
          "unit",
          "model_answer",
          "marking_points",
          "answer_source",
          "marks",
          "topic_code",
          "needs_figure",
          "figure_page",
        ],
        properties: {
          ref: { type: "string" },
          context: { type: "string" },
          stem: { type: "string" },
          kind: { type: "string", enum: ["mcq", "numeric", "short", "extended"] },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "text"],
              properties: { label: { type: "string" }, text: { type: "string" } },
            },
          },
          correct_option: { type: "string" },
          value: { type: "string" },
          unit: { type: "string" },
          model_answer: { type: "string" },
          marking_points: { type: "array", items: { type: "string" } },
          answer_source: { type: "string", enum: ["marking_guide", "ai_suggested"] },
          marks: { type: "integer" },
          topic_code: { type: "string" },
          needs_figure: { type: "boolean" },
          figure_page: { type: "integer" },
        },
      },
    },
  },
};

export const EXTRACT_QUESTIONS_INSTRUCTIONS = `Task: you are helping a mentor build a question bank from a school test or past exam. This output is for the mentor to review, not for a student.

You will receive:
- <subject>: the subject.
- <topics>: the subject's topics, each with a code, title and key points.
- <paper>: some pages of the paper, as extracted text. Page numbers are marked like [page 7].
- <following_pages> (sometimes): the next pages, for context only.
- <answers> (sometimes): the marking guide or examiner report for this paper.

Extract every question (and every part of a multi-part question) that STARTS on the <paper> pages. Do not extract questions that start in <following_pages>; a later batch will do those. Skip cover pages, instructions, data booklets and formula sheets.

For each question part:
- ref: short reference, e.g. "Section A Q12" or "Section B Q5c".
- context: the shared scenario or information that comes before the parts of a multi-part question, repeated for each part. "" if none.
- stem: the question part itself, copied as written (fix obvious text-extraction glitches only). Write formulas plainly, e.g. CH3COOH, Fe3+, 2.5 × 10^-3.
- kind: "mcq" for multiple choice; "numeric" when the answer is a single number; "short" for written answers worth up to 3 marks; "extended" for longer written answers.
- options: for "mcq", every option with its label (A, B, C, D); otherwise [].
- correct_option: for "mcq", the correct label; otherwise "".
- value and unit: for "numeric", the final answer as a plain number (e.g. "0.0251") and its unit (or ""); otherwise "".
- model_answer: a complete model answer (for "numeric", with working). marking_points: the separate points a marker looks for (for "mcq", []).
- answer_source: "marking_guide" if the answer comes from <answers>; "ai_suggested" if <answers> doesn't cover it and you worked it out yourself. Never pretend a suggested answer came from the marking guide.
- marks: the marks shown on the paper (1 for an mcq if not shown); 0 if you can't tell.
- topic_code: the code of the topic in <topics> whose key points this question tests most; "" if none fits.
- needs_figure: true if the question can't be answered without a diagram, graph, structure, table or image that isn't fully in the text. figure_page: the page number it's on (0 if needs_figure is false).

Return only the JSON object described by the schema.`;

export function buildExtractPrompt(input: {
  subjectName: string;
  topics: { code: string; title: string; keyPoints: string[] }[];
  paperTitle: string;
  pages: { pageStart: number; pageEnd: number; text: string }[];
  followingPages: string;
  answersText: string;
}): string {
  const lines = [
    "<subject>",
    input.subjectName,
    "</subject>",
    "",
    "<topics>",
    ...input.topics.map(
      (t) => `${t.code}: ${t.title}\n${t.keyPoints.map((k) => `  - ${k}`).join("\n")}`,
    ),
    "</topics>",
    "",
    `<paper title="${input.paperTitle.replace(/"/g, "'")}">`,
    ...input.pages.map((p) => `[page ${p.pageStart}${p.pageEnd > p.pageStart ? `–${p.pageEnd}` : ""}]\n${p.text}`),
    "</paper>",
  ];
  if (input.followingPages) {
    lines.push("", "<following_pages>", input.followingPages, "</following_pages>");
  }
  if (input.answersText) {
    lines.push("", "<answers>", input.answersText, "</answers>");
  }
  return lines.join("\n");
}

// A row ready for the questions table, or null if the AI's item is unusable.
export type QuestionDraft = {
  source_ref: string | null;
  kind: ExtractedQuestion["kind"];
  context: string | null;
  stem: string;
  options: { label: string; text: string }[] | null;
  answer: Record<string, unknown>;
  marks: number | null;
  needs_figure: boolean;
  figure_page: number | null;
  topic_code: string;
};

// Checks and tidies one extracted question. MCQs without options or a valid
// correct option, and numerics without a number, fall back to "short".
export function toQuestionDraft(q: ExtractedQuestion): QuestionDraft | null {
  const stem = q.stem.trim();
  if (!stem || stem.length > 6000) return null;
  const context = q.context.trim().slice(0, 6000) || null;
  const markingPoints = q.marking_points.map((m) => m.trim()).filter(Boolean).slice(0, 20);
  const modelAnswer = q.model_answer.trim();
  const aiSuggested = q.answer_source === "ai_suggested";

  let kind = q.kind;
  let options: QuestionDraft["options"] = null;
  let answer: Record<string, unknown>;

  const cleanOptions = q.options
    .map((o) => ({ label: o.label.trim().toUpperCase().slice(0, 3), text: o.text.trim() }))
    .filter((o) => o.label && o.text);
  const correct = q.correct_option.trim().toUpperCase();
  const value = Number(q.value.replace(/[,\s]/g, "").replace(/[×x*]10\^?/i, "e"));

  if (kind === "mcq" && cleanOptions.length >= 2 && cleanOptions.some((o) => o.label === correct)) {
    options = cleanOptions;
    answer = { correct_option: correct };
  } else if (kind === "numeric" && q.value.trim() !== "" && Number.isFinite(value)) {
    answer = {
      value,
      unit: q.unit.trim(),
      tolerance_pct: 2,
      model_answer: modelAnswer,
      marking_points: markingPoints,
    };
  } else {
    if (kind === "mcq" || kind === "numeric") kind = "short";
    if (!modelAnswer && markingPoints.length === 0) return null;
    answer = { model_answer: modelAnswer, marking_points: markingPoints };
  }
  if (aiSuggested) answer.ai_suggested = true;

  return {
    source_ref: q.ref.trim().slice(0, 120) || null,
    kind,
    context,
    stem,
    options,
    answer,
    marks: q.marks >= 1 && q.marks <= 30 ? q.marks : null,
    needs_figure: q.needs_figure,
    figure_page: q.needs_figure && q.figure_page > 0 ? q.figure_page : null,
    topic_code: q.topic_code.trim(),
  };
}
