"use client";

import { useActionState } from "react";
import { proposeObjectives, type ProposeState } from "./actions";

const initialState: ProposeState = { message: "", isError: false };

export function ProposeButton({
  subjectId,
  hasDrafts,
}: {
  subjectId: string;
  hasDrafts: boolean;
}) {
  const [state, formAction, pending] = useActionState(proposeObjectives, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (hasDrafts && !confirm("This replaces all current DRAFT objectives. Approved ones stay. Continue?"))
          e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="subject_id" value={subjectId} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {pending
          ? "Claude is reading the curriculum… (1–3 minutes)"
          : hasDrafts
            ? "Propose again with AI"
            : "Propose objectives with AI"}
      </button>
      <p className="text-sm text-zinc-600">
        Uses the main AI model once: roughly 10–20 US cents. Everything it proposes starts as a
        draft for a mentor to review.
      </p>
      {state.message && (
        <p role="status" className={state.isError ? "text-red-700" : "text-green-700"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
