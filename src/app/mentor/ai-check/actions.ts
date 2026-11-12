"use server";

import { requireRole } from "@/lib/auth";
import { askClaude } from "@/lib/ai/client";
import { AI_PAUSED_MESSAGE, AiPausedError } from "@/lib/ai/budget";

export type AiCheckState = { message: string; isError: boolean };

// Sends one tiny message with the cheap model to prove the key, the budget
// check and usage logging all work. Admin only.
export async function runAiCheck(): Promise<AiCheckState> {
  const profile = await requireRole(["admin"]);
  try {
    const reply = await askClaude({
      purpose: "ai_check",
      tier: "cheap",
      user: { id: profile.id, role: profile.role },
      instructions: "This is a connection test. Reply in five words or fewer.",
      prompt: "Say hello to the Study Club mentors.",
      maxTokens: 50,
    });
    return { message: `Claude replied: “${reply.trim()}”`, isError: false };
  } catch (error) {
    if (error instanceof AiPausedError) {
      const why =
        error.reason === "not_configured"
          ? "ANTHROPIC_API_KEY or AI_MONTHLY_BUDGET_CENTS is not set."
          : error.reason === "monthly_budget"
            ? "This month's budget is used up."
            : "Daily limit reached.";
      return { message: `${AI_PAUSED_MESSAGE} (${why})`, isError: true };
    }
    // Show the type of failure only, never keys or request details.
    const name = error instanceof Error ? error.name : "Error";
    return { message: `The AI check failed (${name}).`, isError: true };
  }
}
