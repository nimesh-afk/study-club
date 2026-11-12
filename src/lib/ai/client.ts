// The ONLY place that calls Claude (CLAUDE.md 2, 6.3). Every call:
//   1. checks the budget first (monthly cap, per-student daily cap),
//   2. puts the child-safety prompt before the task's own instructions,
//   3. records tokens and cost in ai_usage afterwards.
// Server code only: the API key must never reach the browser.
// Never log prompts or responses (CLAUDE.md 6.1). Never put student names or
// emails in a prompt: use internal ids only.
import Anthropic from "@anthropic-ai/sdk";
import type { Role } from "@/lib/auth";
import { checkBudget, recordUsage } from "./budget";
import { MODELS, costCents, type ModelTier } from "./models";
import { SAFETY_SYSTEM_PROMPT } from "./prompts/safety";

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (typeof window !== "undefined") {
    throw new Error("Claude must never be called from the browser.");
  }
  anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export type AskOptions = {
  // Short label stored in ai_usage, e.g. "propose_objectives".
  purpose: string;
  // "main" (Sonnet-class) or "cheap" (Haiku-class). See models.ts.
  tier: ModelTier;
  // Who the call is for (from requireRole). Null for background jobs.
  user: { id: string; role: Role } | null;
  // The task's own instructions. Added after the safety prompt.
  instructions: string;
  // The message to answer: keep it to the smallest useful context (CLAUDE.md 5.3).
  prompt: string;
  maxTokens?: number;
};

// Thrown when Claude didn't give a usable answer (refused, cut off, bad JSON).
export class AiAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAnswerError";
  }
}

async function callClaude(
  options: AskOptions,
  jsonSchema?: Record<string, unknown>,
): Promise<string> {
  await checkBudget(options.user);

  const model = MODELS[options.tier];
  const response = await getAnthropic().messages.create({
    model,
    max_tokens: options.maxTokens ?? 2000,
    system: [
      { type: "text", text: SAFETY_SYSTEM_PROMPT },
      { type: "text", text: options.instructions },
    ],
    messages: [{ role: "user", content: options.prompt }],
    ...(jsonSchema
      ? { output_config: { format: { type: "json_schema", schema: jsonSchema } } }
      : {}),
  });

  // Count cache tokens as normal input: we don't use caching yet, and this
  // can only over-estimate the cost, never under-estimate it.
  const usage = response.usage;
  const inputTokens =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  await recordUsage({
    userId: options.user?.id ?? null,
    purpose: options.purpose,
    model,
    inputTokens,
    outputTokens: usage.output_tokens,
    costCents: costCents(model, inputTokens, usage.output_tokens),
  });

  if (response.stop_reason === "refusal") {
    throw new AiAnswerError("Claude declined to answer.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiAnswerError("Claude's answer was cut off (raise maxTokens).");
  }
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

// Plain-text answer (explanations, feedback).
export async function askClaude(options: AskOptions): Promise<string> {
  return callClaude(options);
}

// Structured answer (grading, proposing objectives). Claude must reply with
// JSON matching `schema` (a JSON Schema object); we parse it for you.
export async function askClaudeJson<T>(
  options: AskOptions,
  schema: Record<string, unknown>,
): Promise<T> {
  const text = await callClaude(options, schema);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiAnswerError("Claude's answer was not valid JSON.");
  }
}
