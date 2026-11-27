"use client";

import { useActionState } from "react";
import { extractQuestions, type ExtractState } from "./actions";

const initialState: ExtractState = { message: "", isError: false };

export function ExtractQuestionsForm({
  documentId,
  answerOptions,
  hasQuestions,
}: {
  documentId: string;
  answerOptions: { id: string; title: string }[];
  hasQuestions: boolean;
}) {
  const [state, formAction, pending] = useActionState(extractQuestions, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (hasQuestions && !confirm("This replaces this paper's DRAFT questions. Approved ones stay. Continue?"))
          e.preventDefault();
      }}
      className="mt-2 flex flex-col gap-2"
    >
      <input type="hidden" name="document_id" value={documentId} />
      <label className="flex flex-col gap-1 text-sm">
        Answers from (marking guide or examiner report)
        <select
          name="answers_document_id"
          defaultValue=""
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base"
        >
          <option value="">None: the AI suggests answers (flagged for checking)</option>
          {answerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Claude is reading the paper… (1–4 minutes)" : "Extract questions with AI"}
      </button>
      {state.message && (
        <p role="status" className={`text-sm ${state.isError ? "text-red-700" : "text-green-700"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
