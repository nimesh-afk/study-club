// Checkpoint quiz rules (CLAUDE.md 1, step 2). Pure functions, no I/O.

export const CHECKPOINT_MIN = 5;
export const CHECKPOINT_MAX = 8;
// Extended answers need several marking points: too harsh for a 100% gate.
// Questions that need a figure are left out until figures can be shown.
export const CHECKPOINT_KINDS = ["mcq", "numeric", "short"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Picks up to CHECKPOINT_MAX questions at random, avoiding the previous
// attempt's questions where the bank is big enough. Returns [] if there are
// fewer than CHECKPOINT_MIN questions in the bank.
export function pickCheckpoint(
  available: string[],
  previous: string[],
  random: () => number = Math.random,
): string[] {
  const unique = [...new Set(available)];
  if (unique.length < CHECKPOINT_MIN) return [];
  const count = Math.min(CHECKPOINT_MAX, unique.length);
  const before = new Set(previous);
  const fresh = shuffle(unique.filter((id) => !before.has(id)), random);
  const repeats = shuffle(unique.filter((id) => before.has(id)), random);
  return shuffle([...fresh, ...repeats].slice(0, count), random);
}

// Reads a number typed by a student: "0.0251", "2.51e-2", "2.51 x 10^-2",
// "2.51×10⁻²" is not supported but "2.51 × 10^-2 mol" is. Units are ignored.
export function parseStudentNumber(text: string): number | null {
  const cleaned = text
    .replace(/,/g, "")
    .replace(/−/g, "-")
    .replace(/\s+/g, "")
    .replace(/[×x*]10\^?/i, "e");
  const match = cleaned.match(/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

export function numericCorrect(expected: number, tolerancePct: number, response: string): boolean {
  const given = parseStudentNumber(response);
  if (given === null) return false;
  if (expected === 0) return Math.abs(given) < 1e-9;
  return Math.abs(given - expected) <= (Math.abs(expected) * Math.max(0, tolerancePct)) / 100;
}

export function mcqCorrect(correctOption: string, response: string): boolean {
  return response.trim().toUpperCase() === correctOption.trim().toUpperCase();
}
