// Prompt + JSON schema for "AI marks short written answers" in the checkpoint
// (CLAUDE.md 5.4). Cheap model. All short answers of one attempt go in one
// call. Only the approved model answer and marking points are the authority.
// Privacy (CLAUDE.md 6.1): no student name, email or id goes in the prompt.

export type MarkedAnswer = {
  number: number;
  correct: boolean;
  feedback: string;
  concern: boolean;
};

export const MARKED_ANSWERS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "correct", "feedback", "concern"],
        properties: {
          number: { type: "integer" },
          correct: { type: "boolean" },
          feedback: { type: "string" },
          concern: { type: "boolean" },
        },
      },
    },
  },
};

export const MARK_ANSWERS_INSTRUCTIONS = `Task: mark a student's short written answers in a checkpoint quiz. Each item gives the question, the approved model answer, the marking points and the student's answer.

For each numbered item:
- correct: true only if the student's answer would earn full marks: it makes every marking point (in any wording; minor spelling mistakes are fine). If the answer is blank, off-topic or misses a marking point, it is false.
- feedback: 1 or 2 short, warm sentences to the student (at most 40 words), speaking to them as "you". If it's not correct, say what was missing or wrong without lecturing.
- concern: true only if the student's answer suggests distress, self-harm, abuse or risk of harm. Otherwise false.

Use only the model answer and marking points to decide. Don't invent extra requirements. Return only the JSON object described by the schema.`;

export function buildMarkAnswersPrompt(
  items: {
    context: string | null;
    stem: string;
    modelAnswer: string;
    markingPoints: string[];
    response: string;
  }[],
): string {
  return items
    .map((item, i) =>
      [
        `<item number="${i + 1}">`,
        item.context ? `<context>${item.context}</context>` : null,
        `<question>${item.stem}</question>`,
        `<model_answer>${item.modelAnswer}</model_answer>`,
        `<marking_points>\n${item.markingPoints.map((m) => `- ${m}`).join("\n")}\n</marking_points>`,
        `<student_answer>${item.response.slice(0, 3000)}</student_answer>`,
        "</item>",
      ]
        .filter((l): l is string => l !== null)
        .join("\n"),
    )
    .join("\n\n");
}
