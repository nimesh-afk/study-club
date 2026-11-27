"use client";

import { useActionState, useState } from "react";
import { saveQuestion, type SaveState } from "../actions";

export type QuestionFormValues = {
  id: string;
  kind: "mcq" | "numeric" | "short" | "extended";
  context: string;
  stem: string;
  options: string; // one per line, "A. text"
  correctOption: string;
  value: string;
  unit: string;
  tolerancePct: string;
  modelAnswer: string;
  markingPoints: string; // one per line
  marks: string;
  objectiveId: string;
  needsFigure: boolean;
};

const initialState: SaveState = { message: "", isError: false };
const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm font-medium";

export function QuestionForm({
  values,
  topics,
}: {
  values: QuestionFormValues;
  topics: { id: string; code: string; title: string | null; statement: string }[];
}) {
  const [state, formAction, pending] = useActionState(saveQuestion, initialState);
  const [kind, setKind] = useState(values.kind);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={values.id} />
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={`${labelClass} sm:col-span-2`}>
          Topic
          <select name="objective_id" defaultValue={values.objectiveId} className={inputClass}>
            <option value="">No topic (can&apos;t be approved)</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} {t.title ?? t.statement}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Marks
          <input name="marks" type="number" min={1} max={30} defaultValue={values.marks} className={inputClass} />
        </label>
      </div>
      <label className={labelClass}>
        Type
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as QuestionFormValues["kind"])}
          className={inputClass}
        >
          <option value="mcq">Multiple choice (marked by the app)</option>
          <option value="numeric">Numeric (marked by the app)</option>
          <option value="short">Short answer</option>
          <option value="extended">Extended answer</option>
        </select>
      </label>
      <label className={labelClass}>
        Shared context (the scenario before a multi-part question; blank if none)
        <textarea name="context" rows={3} defaultValue={values.context} className={inputClass} />
      </label>
      <label className={labelClass}>
        Question
        <textarea name="stem" required rows={4} defaultValue={values.stem} className={inputClass} />
      </label>

      {kind === "mcq" && (
        <>
          <label className={labelClass}>
            Options, one per line (e.g. &quot;A. 2.5 mol&quot;)
            <textarea name="options" rows={5} defaultValue={values.options} className={inputClass} />
          </label>
          <label className={labelClass}>
            Correct option (letter)
            <input name="correct_option" maxLength={3} defaultValue={values.correctOption} className={inputClass} />
          </label>
        </>
      )}

      {kind === "numeric" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={labelClass}>
            Answer (number, e.g. 0.0251 or 2.5e-3)
            <input name="value" defaultValue={values.value} className={inputClass} />
          </label>
          <label className={labelClass}>
            Unit
            <input name="unit" defaultValue={values.unit} className={inputClass} />
          </label>
          <label className={labelClass}>
            Allowed error (%)
            <input name="tolerance_pct" type="number" min={0} max={20} step="0.5" defaultValue={values.tolerancePct} className={inputClass} />
          </label>
        </div>
      )}

      {kind !== "mcq" && (
        <>
          <label className={labelClass}>
            Model answer{kind === "numeric" ? " (with working)" : ""}
            <textarea name="model_answer" rows={4} defaultValue={values.modelAnswer} className={inputClass} />
          </label>
          <label className={labelClass}>
            Marking points, one per line
            <textarea name="marking_points" rows={4} defaultValue={values.markingPoints} className={inputClass} />
          </label>
        </>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="needs_figure" defaultChecked={values.needsFigure} className="mt-1" />
        <span>Needs a figure (diagram, graph, structure or table) that isn&apos;t in the text</span>
      </label>

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
