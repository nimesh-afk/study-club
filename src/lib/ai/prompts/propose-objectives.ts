// Prompt + JSON schema for "AI proposes objectives" (CLAUDE.md 1, step 2).
// Input: the curriculum text (rank 1 source) plus the textbook's section
// headings and the curriculum codes each chapter covers (headings and codes
// only, never textbook passages: CLAUDE.md 5.3, 5.5).
// Output: draft objectives + prerequisites. A mentor approves them later.

export const STRANDS = [
  "Number",
  "Algebra",
  "Measurement",
  "Space",
  "Statistics",
  "Probability",
] as const;

export type ProposedObjective = {
  code: string;
  strand: (typeof STRANDS)[number];
  statement: string;
  curriculum_text: string;
};

export type ProposedMap = {
  objectives: ProposedObjective[];
  prerequisites: { objective_code: string; prereq_code: string }[];
};

// Structured output schema: Claude's reply must match this exactly.
export const PROPOSED_MAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["objectives", "prerequisites"],
  properties: {
    objectives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "strand", "statement", "curriculum_text"],
        properties: {
          code: { type: "string" },
          strand: { type: "string", enum: [...STRANDS] },
          statement: { type: "string" },
          curriculum_text: { type: "string" },
        },
      },
    },
    prerequisites: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objective_code", "prereq_code"],
        properties: {
          objective_code: { type: "string" },
          prereq_code: { type: "string" },
        },
      },
    },
  },
};

export const PROPOSE_OBJECTIVES_INSTRUCTIONS = `Task: you are helping a mentor build a learning map for Year 8 Mathematics (Victorian Curriculum 2.0, Level 8). This output is for the mentor to review, not for a student.

You will receive:
- <curriculum>: the official curriculum text. This is the authority: every objective must come from a content description in it.
- <textbook_sections>: the class textbook's section headings, for deciding how finely to split.
- <textbook_chapter_codes>: which curriculum codes each textbook chapter covers.

Produce "atomic objectives":
- At least one objective per Level 8 content description (codes like VC2M8N04). Ignore other levels if present.
- If a content description bundles clearly different skills (the textbook teaching them in separate sections is a good sign), split it into 2 to 5 objectives coded with a suffix: VC2M8N04.1, VC2M8N04.2, ... Otherwise use the plain code. Never use both the plain code and suffixed codes for the same content description.
- statement: one sentence, at most 25 words, plain language a Year 8 student understands, starting with a verb (e.g. "Add and subtract negative integers using a number line or rules.").
- curriculum_text: the content description's exact wording copied from <curriculum> (the same text for every objective split from it). Do not paraphrase it.
- strand: the curriculum strand it belongs to.
- Do not invent content that is not in the curriculum.

Prerequisites:
- List only direct prerequisites: B is a prerequisite of A if a student really needs B before starting A (e.g. integer operations before rational number operations).
- Use only codes from your own objectives list. No cycles. Keep it sparse: most objectives have 0 to 2 prerequisites.

Return only the JSON object described by the schema.`;

export function buildProposePrompt(input: {
  curriculumText: string;
  sectionHeadings: string[];
  chapterCodes: { chapter: string; codes: string[] }[];
}): string {
  return [
    "<curriculum>",
    input.curriculumText,
    "</curriculum>",
    "",
    "<textbook_sections>",
    ...input.sectionHeadings,
    "</textbook_sections>",
    "",
    "<textbook_chapter_codes>",
    ...input.chapterCodes.map((c) => `${c.chapter}: ${c.codes.join(", ")}`),
    "</textbook_chapter_codes>",
  ].join("\n");
}

// Remove prerequisite links that point at unknown codes, repeat, or would
// create a loop (A needs B needs A). Keeps the first links Claude gave.
export function cleanPrerequisites(map: ProposedMap): ProposedMap["prerequisites"] {
  const codes = new Set(map.objectives.map((o) => o.code));
  const edges = new Map<string, Set<string>>(); // objective -> its prereqs
  const kept: ProposedMap["prerequisites"] = [];

  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of edges.get(from) ?? []) if (reaches(next, target, seen)) return true;
    return false;
  };

  for (const p of map.prerequisites) {
    const { objective_code: a, prereq_code: b } = p;
    if (!codes.has(a) || !codes.has(b) || a === b) continue;
    if (edges.get(a)?.has(b)) continue;
    if (reaches(b, a)) continue; // b already (indirectly) needs a: adding would loop
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a)!.add(b);
    kept.push(p);
  }
  return kept;
}
