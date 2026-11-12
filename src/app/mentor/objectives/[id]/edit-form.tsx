"use client";

import { useActionState } from "react";
import { saveObjective, type ReviewState } from "../actions";

export type PrereqOption = { id: string; code: string; statement: string; strand: string };

const initialState: ReviewState = { message: "", isError: false };
const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-zinc-900";

export function EditForm({
  objective,
  strands,
  options,
  selected,
}: {
  objective: { id: string; statement: string; strand: string };
  strands: readonly string[];
  options: PrereqOption[];
  selected: string[];
}) {
  const [state, formAction, pending] = useActionState(saveObjective, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={objective.id} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Statement (what the student should be able to do)
        <textarea
          name="statement"
          required
          maxLength={500}
          rows={3}
          defaultValue={objective.statement}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Strand
        <select name="strand" defaultValue={objective.strand} className={inputClass}>
          {strands.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">
          Needs first (prerequisites). Keep it to the 0–2 that really matter.
        </legend>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-200 p-2">
          {strands.map((strand) => {
            const inStrand = options.filter((o) => o.strand === strand);
            if (inStrand.length === 0) return null;
            return (
              <div key={strand} className="mb-2">
                <p className="text-xs font-semibold uppercase text-zinc-500">{strand}</p>
                {inStrand.map((o) => (
                  <label key={o.id} className="flex items-start gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      name="prereq_ids"
                      value={o.id}
                      defaultChecked={selected.includes(o.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-mono text-zinc-600">{o.code}</span> {o.statement}
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
      {state.message && (
        <p role="status" className={state.isError ? "text-red-700" : "text-green-700"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
