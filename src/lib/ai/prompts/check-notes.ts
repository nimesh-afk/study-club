// Prompt + JSON schema for "AI checks a student's handwritten notes"
// (CLAUDE.md 1, step 1). Input: the topic's key points and photos of the notes.
// Output: which key points the notes cover. The decision (accept or not) is
// made in code (src/lib/notes/decide.ts), not by the AI.
// Privacy (CLAUDE.md 6.1): no student name, email or id goes in the prompt.

export type NotesCheck = {
  is_study_notes: boolean;
  readable: boolean;
  key_points: { number: number; covered: "yes" | "partly" | "no" }[];
  feedback: string;
};

export const NOTES_CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_study_notes", "readable", "key_points", "feedback"],
  properties: {
    is_study_notes: { type: "boolean" },
    readable: { type: "boolean" },
    key_points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "covered"],
        properties: {
          number: { type: "integer" },
          covered: { type: "string", enum: ["yes", "partly", "no"] },
        },
      },
    },
    feedback: { type: "string" },
  },
};

export const CHECK_NOTES_INSTRUCTIONS = `Task: a student has photographed their own handwritten study notes for one topic. Check how well the notes cover the topic's key points. You are checking coverage, not neatness, spelling or style.

You will receive the photos, then <topic> with its title and numbered <key_points>.

- is_study_notes: false if the photos are not study notes for this subject (e.g. blank pages, printed pages copied from a book, unrelated pictures).
- readable: false if the photos are too blurry, dark or cut off to read most of the notes.
- key_points: one entry per numbered key point. "yes" = the notes explain it in the student's own words (a heading alone isn't enough); "partly" = mentioned but thin or with a clear error; "no" = missing.
- feedback: 1 to 3 short, warm sentences to the student (at most 60 words): what is done well and which key points to add or fix. Speak to them as "you". Don't mention any names, faces or personal details that appear in the photos. Don't give a score.

Return only the JSON object described by the schema.`;

export function buildCheckNotesPrompt(topic: { title: string; keyPoints: string[] }): string {
  return [
    "<topic>",
    topic.title,
    "<key_points>",
    ...topic.keyPoints.map((k, i) => `${i + 1}. ${k}`),
    "</key_points>",
    "</topic>",
  ].join("\n");
}
