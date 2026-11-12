// Spend control for Claude calls (CLAUDE.md 6.4).
//   * checkBudget()  runs BEFORE every call: monthly cap + per-student daily cap.
//   * recordUsage()  runs AFTER every call: one row in ai_usage.
// Uses the admin client because usage logging is a server-only job (CLAUDE.md 6.2).
// Server code only.
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/auth";

// Max Claude calls per student in any rolling 24 hours. Catches loops and bugs.
export const STUDENT_DAILY_CALL_LIMIT = 150;

export type AiPauseReason = "monthly_budget" | "daily_limit" | "not_configured";

// Thrown when AI is paused. Pages catch it and show AI_PAUSED_MESSAGE.
export class AiPausedError extends Error {
  constructor(public reason: AiPauseReason) {
    super(`AI paused: ${reason}`);
    this.name = "AiPausedError";
  }
}

export const AI_PAUSED_MESSAGE =
  "The AI tutor is paused for now. Please ask a mentor. Everything else still works.";

function monthlyBudgetCents(): number | null {
  const raw = process.env.AI_MONTHLY_BUDGET_CENTS;
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Total spent this calendar month (Melbourne time), in US cents.
export async function spendThisMonthCents(): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ai_spend_this_month_cents");
  if (error) throw new Error("Could not read AI spend.");
  return Number(data ?? 0);
}

export async function checkBudget(user: { id: string; role: Role } | null) {
  const budget = monthlyBudgetCents();
  // No budget set (or no API key)? Stay paused rather than spend without a limit.
  if (budget === null || !process.env.ANTHROPIC_API_KEY) {
    throw new AiPausedError("not_configured");
  }

  if ((await spendThisMonthCents()) >= budget) {
    throw new AiPausedError("monthly_budget");
  }

  if (user?.role === "student") {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await admin
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (error) throw new Error("Could not read AI usage.");
    if ((count ?? 0) >= STUDENT_DAILY_CALL_LIMIT) {
      throw new AiPausedError("daily_limit");
    }
  }
}

export async function recordUsage(row: {
  userId: string | null;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("ai_usage").insert({
    user_id: row.userId,
    purpose: row.purpose,
    model: row.model,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    cost_cents: Number(row.costCents.toFixed(4)),
  });
  // Don't throw: the call already happened and the user should get the answer.
  // Log only that it failed, never the content (CLAUDE.md 6.1).
  if (error) console.error("ai_usage insert failed", error.code);
}
