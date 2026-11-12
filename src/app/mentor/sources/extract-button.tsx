"use client";

import { useActionState } from "react";
import { extractDocument, type ExtractState } from "./actions";

const initialState: ExtractState = { message: "", isError: false };

export function ExtractButton({ documentId }: { documentId: string }) {
  const [state, formAction, pending] = useActionState(extractDocument, initialState);
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-1">
      <input type="hidden" name="document_id" value={documentId} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Extracting… (up to a minute)" : "Extract text"}
      </button>
      {state.message && (
        <p role="status" className={`text-sm ${state.isError ? "text-red-700" : "text-green-700"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
