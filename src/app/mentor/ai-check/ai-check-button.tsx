"use client";

import { useActionState } from "react";
import { runAiCheck, type AiCheckState } from "./actions";

const initialState: AiCheckState = { message: "", isError: false };

export function AiCheckButton() {
  const [state, formAction, pending] = useActionState(runAiCheck, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Asking Claude…" : "Send a test message"}
      </button>
      {state.message && (
        <p
          role="status"
          className={state.isError ? "text-red-700" : "text-green-700"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
