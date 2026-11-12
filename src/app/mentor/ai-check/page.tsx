import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { SignedInShell } from "@/components/signed-in-shell";
import { spendThisMonthCents } from "@/lib/ai/budget";
import { AiCheckButton } from "./ai-check-button";

function dollars(cents: number): string {
  return `US$${(cents / 100).toFixed(2)}`;
}

export default async function AiCheckPage() {
  const profile = await requireRole(["admin"]);

  const budgetRaw = Number(process.env.AI_MONTHLY_BUDGET_CENTS);
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  let spent: number | null = null;
  try {
    spent = await spendThisMonthCents();
  } catch {
    spent = null; // e.g. the ai_usage migration hasn't been applied yet
  }

  return (
    <SignedInShell profile={profile}>
      <Link href="/mentor" className="text-sm text-zinc-600">
        ← Mentor area
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">AI check</h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-zinc-600">API key</dt>
        <dd>{hasKey ? "set" : "missing"}</dd>
        <dt className="text-zinc-600">Monthly budget</dt>
        <dd>{budget === null ? "missing" : dollars(budget)}</dd>
        <dt className="text-zinc-600">Spent this month</dt>
        <dd>{spent === null ? "unknown (is the ai_usage migration applied?)" : dollars(spent)}</dd>
      </dl>
      <div className="mt-6">
        <AiCheckButton />
      </div>
    </SignedInShell>
  );
}
