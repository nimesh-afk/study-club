"use client";

import { useActionState } from "react";
import { saveTopic, type ReviewState } from "../actions";

const initialState: ReviewState = { message: "", isError: false };
const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-zinc-900";

export function EditForm({
  topic,
  groupingLabel,
  groups,
}: {
  topic: {
    id: string;
    title: string;
    statement: string;
    unit: string;
    group: string;
    keyPoints: string[];
    locked: boolean;
  };
  groupingLabel: string;
  groups: string[];
}) {
  const [state, formAction, pending] = useActionState(saveTopic, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={topic.id} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Title (a few words)
        <input name="title" required maxLength={80} defaultValue={topic.title} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Statement (what the student will be able to do)
        <textarea
          name="statement"
          required
          maxLength={500}
          rows={3}
          defaultValue={topic.statement}
          className={inputClass}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Unit (blank if none)
          <input name="unit" maxLength={40} defaultValue={topic.unit} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          {groupingLabel}
          <input
            name="group"
            required
            maxLength={200}
            list="topic-groups"
            defaultValue={topic.group}
            className={inputClass}
          />
          <datalist id="topic-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Key points, one per line (the curriculum dot points this topic covers)
        <textarea
          name="key_points"
          required
          rows={Math.min(16, Math.max(5, topic.keyPoints.length + 2))}
          defaultValue={topic.keyPoints.join("\n")}
          className={inputClass}
        />
        <span className="font-normal text-zinc-600">
          Used to check students&apos; notes and to sort questions into topics.
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="locked" defaultChecked={topic.locked} className="mt-1" />
        <span>
          <span className="font-medium">Keep in order:</span> students must pass the earlier
          topics&apos; checkpoints before starting this one.
        </span>
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
