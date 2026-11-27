// Prompt + JSON schema for "AI proposes topics" (CLAUDE.md 1 "Topics").
// Works for any subject: the subject row says how its curriculum is organised.
// Input: the curriculum text (rank 1 source) and, if a textbook was uploaded,
// its section headings (headings only, never textbook passages: CLAUDE.md 5.5).
// Output: 10–20 draft topics with key points. A mentor approves them later.

export const TOPIC_TARGET = { min: 10, max: 20 } as const;

export type ProposedTopic = {
  unit: string; // "Unit 3", or "" when the curriculum has no units
  group: string; // area of study / strand
  title: string;
  statement: string;
  key_points: string[];
};

export type ProposedTopics = { topics: ProposedTopic[] };

// Structured output schema: Claude's reply must match this exactly.
export const PROPOSED_TOPICS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topics"],
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["unit", "group", "title", "statement", "key_points"],
        properties: {
          unit: { type: "string" },
          group: { type: "string" },
          title: { type: "string" },
          statement: { type: "string" },
          key_points: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export const PROPOSE_TOPICS_INSTRUCTIONS = `Task: you are helping a mentor split one school subject into topics for a study app. This output is for the mentor to review, not for a student.

You will receive:
- <subject>: the subject, its level, what its curriculum calls its groups (e.g. "Area of study" or "Strand"), and which part of the curriculum document to use.
- <curriculum>: the official curriculum text. This is the authority: every topic must come from it.
- <textbook_sections> (sometimes): the class textbook's section headings, as a hint for sensible topic sizes.

Produce between ${TOPIC_TARGET.min} and ${TOPIC_TARGET.max} topics that together cover everything in scope, in the curriculum's own order:
- A topic is a sensible study chunk: roughly 1 to 3 weeks of school work, small enough for one set of handwritten notes and one short quiz.
- Use only the part of the curriculum named in <subject>. Ignore other units or levels.
- unit: the unit it belongs to, e.g. "Unit 3". Use "" if the curriculum has no units.
- group: the title of the area of study or strand it belongs to, as written in the curriculum (a shortened form is fine).
- title: at most 8 words.
- statement: one sentence, at most 30 words, in plain language a student understands, saying what they will be able to do or explain.
- key_points: the curriculum dot points (for VCE: the "key knowledge" dot points; for Years 7–10: the content descriptions) that this topic covers, each copied word for word from <curriculum> (drop bullet characters only). Every in-scope dot point appears in exactly one topic. Usually 2 to 12 per topic.
- For VCE studies: build topics from key knowledge only. Do not make topics from key science skills, outcome statements, assessment tasks or the student-designed investigation.
- Do not invent content that is not in the curriculum.

Return only the JSON object described by the schema.`;

export function buildProposeTopicsPrompt(input: {
  subjectName: string;
  levelLabel: string | null;
  groupingLabel: string;
  scopeNote: string | null;
  curriculumText: string;
  sectionHeadings: string[];
}): string {
  const lines = [
    "<subject>",
    `Name: ${input.subjectName}`,
    input.levelLabel ? `Level: ${input.levelLabel}` : null,
    `The curriculum's groups are called: ${input.groupingLabel}`,
    input.scopeNote ? `Use only: ${input.scopeNote}` : null,
    "</subject>",
    "",
    "<curriculum>",
    input.curriculumText,
    "</curriculum>",
  ];
  if (input.sectionHeadings.length > 0) {
    lines.push("", "<textbook_sections>", ...input.sectionHeadings, "</textbook_sections>");
  }
  return lines.filter((l): l is string => l !== null).join("\n");
}

// Checks one proposed topic and tidies it. Returns null if it's unusable.
export function cleanTopic(t: ProposedTopic): ProposedTopic | null {
  const unit = t.unit.trim().slice(0, 40);
  const group = t.group.trim().slice(0, 200);
  const title = t.title.trim();
  const statement = t.statement.trim();
  const keyPoints = [
    ...new Set(
      t.key_points
        .map((k) => k.replace(/^[\s•\-–*]+/, "").trim())
        .filter((k) => k.length > 0 && k.length <= 1000),
    ),
  ].slice(0, 30);
  if (!group || !title || title.length > 80) return null;
  if (!statement || statement.length > 500) return null;
  if (keyPoints.length === 0) return null;
  return { unit, group, title, statement, key_points: keyPoints };
}

// Topic codes are simple: T01, T02, ... skipping codes already used in the
// subject (approved and retired topics keep theirs).
export function nextTopicCodes(used: Iterable<string>, count: number): string[] {
  const taken = new Set(used);
  const codes: string[] = [];
  for (let n = 1; codes.length < count; n++) {
    const code = `T${String(n).padStart(2, "0")}`;
    if (!taken.has(code)) codes.push(code);
  }
  return codes;
}
