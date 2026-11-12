"use client";

import { approveAllDrafts } from "./actions";

export function ApproveAllButton({ subjectId, count }: { subjectId: string; count: number }) {
  return (
    <form
      action={approveAllDrafts}
      onSubmit={(e) => {
        if (!confirm(`Approve all ${count} drafts? Students will be able to see them.`))
          e.preventDefault();
      }}
    >
      <input type="hidden" name="subject_id" value={subjectId} />
      <button className="rounded-lg bg-green-700 px-4 py-2.5 font-medium text-white">
        Approve all {count} drafts
      </button>
    </form>
  );
}
