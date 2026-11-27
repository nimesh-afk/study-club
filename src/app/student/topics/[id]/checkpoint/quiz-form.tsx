"use client";

import { startTransition, useActionState } from "react";
import type { StudentQuestion } from "@/lib/checkpoint/service";
import { submitCheckpoint, type CheckpointState } from "./actions";

const initialState: CheckpointState = { message: "", isError: false };
const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-zinc-900";

export function QuizForm({
  attemptId,
  objectiveId,
  questions,
}: {
  attemptId: string;
  objectiveId: string;
  questions: StudentQuestion[];
}) {
  const [state, formAction, pending] = useActionState(submitCheckpoint, initialState);
  return (
    <form
      // Submitted by hand (not action=) so React doesn't clear the answers if
      // marking fails and the student needs to submit again.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="attempt_id" value={attemptId} />
      <input type="hidden" name="objective_id" value={objectiveId} />
      {questions.map((q, i) => (
        <fieldset key={q.id} className="rounded-xl border border-zinc-200 p-4">
          <legend className="px-1 text-sm font-medium text-zinc-600">
            Question {i + 1} of {questions.length}
            {q.marks ? ` · ${q.marks} mark${q.marks > 1 ? "s" : ""}` : ""}
          </legend>
          {q.context && <p className="mb-2 whitespace-pre-line text-zinc-700">{q.context}</p>}
          <p className="whitespace-pre-line font-medium">{q.stem}</p>
          {q.kind === "mcq" && q.options && (
            <div className="mt-3 flex flex-col gap-2">
              {q.options.map((o) => (
                <label key={o.label} className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3">
                  <input type="radio" name={`q_${q.id}`} value={o.label} required className="mt-1" />
                  <span>
                    <span className="font-medium">{o.label}.</span> {o.text}
                  </span>
                </label>
              ))}
            </div>
          )}
          {q.kind === "numeric" && (
            <label className="mt-3 flex flex-col gap-1 text-sm">
              Your answer (a number{q.unit ? `, in ${q.unit}` : ""}; e.g. 0.025 or 2.5 x 10^-2)
              <input name={`q_${q.id}`} inputMode="decimal" autoComplete="off" required className={inputClass} />
            </label>
          )}
          {q.kind === "short" && (
            <label className="mt-3 flex flex-col gap-1 text-sm">
              Your answer
              <textarea name={`q_${q.id}`} rows={3} maxLength={3000} required className={inputClass} />
            </label>
          )}
        </fieldset>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Marking…" : "Submit answers"}
      </button>
      {state.message && (
        <p role="status" className={state.isError ? "text-red-700" : "text-green-700"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
