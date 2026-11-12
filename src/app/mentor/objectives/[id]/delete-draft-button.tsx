"use client";

import { changeObjectiveStatus } from "../actions";

// Deleting is permanent, so ask first. Only drafts can be deleted.
export function DeleteDraftButton({ id }: { id: string }) {
  return (
    <form
      action={changeObjectiveStatus}
      onSubmit={(e) => {
        if (!confirm("Delete this draft objective? This can't be undone.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value="delete" />
      <button className="rounded-lg border border-red-300 px-4 py-2.5 font-medium text-red-700">
        Delete draft
      </button>
    </form>
  );
}
