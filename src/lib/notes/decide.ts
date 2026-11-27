// Decides whether a notes check passes (CLAUDE.md 1, step 1). Pure function.
// The AI only reports which key points are covered; this rule makes the call.

// Share of the key points that must be covered ("partly" counts as half).
export const NOTES_PASS_SHARE = 0.8;
// Photos are deleted this many days after a decision (CLAUDE.md 6.1).
export const NOTES_PHOTO_DAYS = 30;
export const MAX_NOTES_PHOTOS = 10;

export type CoverageItem = { point: string; covered: "yes" | "partly" | "no" };

export function coverageShare(items: CoverageItem[]): number {
  if (items.length === 0) return 0;
  const score = items.reduce(
    (sum, i) => sum + (i.covered === "yes" ? 1 : i.covered === "partly" ? 0.5 : 0),
    0,
  );
  return score / items.length;
}

export function notesPass(input: {
  isStudyNotes: boolean;
  readable: boolean;
  items: CoverageItem[];
}): boolean {
  return input.isStudyNotes && input.readable && coverageShare(input.items) >= NOTES_PASS_SHARE;
}

// Lines the AI's answer up with the topic's key points. Any point the AI
// skipped counts as not covered.
export function matchCoverage(
  keyPoints: string[],
  reported: { number: number; covered: CoverageItem["covered"] }[],
): CoverageItem[] {
  return keyPoints.map((point, i) => ({
    point,
    covered: reported.find((r) => r.number === i + 1)?.covered ?? "no",
  }));
}
