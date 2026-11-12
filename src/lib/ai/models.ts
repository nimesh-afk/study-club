// The ONLY place model names and prices live (CLAUDE.md 2).
// To switch models, change them here and nowhere else.

export type ModelTier = "main" | "cheap";

// main  = tutoring, grading, proposing objectives (Sonnet-class)
// cheap = tagging, short feedback (Haiku-class)
export const MODELS: Record<ModelTier, string> = {
  main: "claude-sonnet-5-5",
  cheap: "claude-haiku-5-5",
};

// US dollars per million tokens, from Anthropic's pricing page (checked Nov 2026).
// Haiku 5.5 is cheaper for prompts up to 100,000 tokens; we never send prompts
// that big (CLAUDE.md 5.3), but the higher rate is here to be safe.
type Price = { input: number; output: number };
const PRICES: Record<string, { normal: Price; longPrompt?: Price }> = {
  "claude-sonnet-5-5": { normal: { input: 2, output: 10 } },
  "claude-haiku-5-5": {
    normal: { input: 0.1, output: 0.5 },
    longPrompt: { input: 0.5, output: 2.5 },
  },
};
const LONG_PROMPT_TOKENS = 100_000;

// Cost of one call in US cents (with fractions).
export function costCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const entry = PRICES[model];
  if (!entry) {
    // Fail loudly so a model change without a price is caught in testing.
    throw new Error(`No price set for model ${model} in src/lib/ai/models.ts`);
  }
  const price =
    inputTokens > LONG_PROMPT_TOKENS && entry.longPrompt
      ? entry.longPrompt
      : entry.normal;
  const dollars =
    (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return dollars * 100;
}
