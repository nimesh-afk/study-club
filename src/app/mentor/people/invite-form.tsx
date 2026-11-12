"use client";

import { useActionState, useState } from "react";
import { inviteMember, type InviteState } from "./actions";

export type PersonOption = {
  id: string;
  display_name: string;
  role: "student" | "parent" | "mentor" | "admin";
};

const initialState: InviteState = { message: "", isError: false };

const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-zinc-900";

export function InviteForm({ people }: { people: PersonOption[] }) {
  const [state, formAction, pending] = useActionState(inviteMember, initialState);
  const [role, setRole] = useState<PersonOption["role"]>("student");

  // Who can this new person be linked to?
  const linkable =
    role === "student"
      ? people.filter((p) => p.role === "parent" || p.role === "mentor")
      : role === "admin"
        ? []
        : people.filter((p) => p.role === "student");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input name="email" type="email" required autoComplete="off" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name (first name is enough)
          <input name="display_name" required maxLength={60} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Role
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as PersonOption["role"])}
            className={inputClass}
          >
            <option value="student">Student</option>
            <option value="parent">Parent</option>
            <option value="mentor">Mentor</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        {role === "student" && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Year level
            <select name="year_level" defaultValue="12" className={inputClass}>
              {[7, 8, 9, 10, 11, 12].map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {linkable.length > 0 && (
        <fieldset className="rounded-lg border border-zinc-200 p-3">
          <legend className="px-1 text-sm font-medium">
            {role === "student" ? "Their parents and mentors" : "Their students"}
          </legend>
          <div className="flex flex-col gap-2">
            {linkable.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="link_ids" value={p.id} />
                {p.display_name}
                <span className="text-zinc-500">({p.role})</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {role === "student" && (
        <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm">
          <input type="checkbox" name="guardian_consent" value="yes" required className="mt-1" />
          <span>
            A parent or guardian has agreed to this student using Study Club,
            including AI tutoring (powered by Anthropic&apos;s Claude) and storage
            of their study progress.
          </span>
        </label>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add person"}
      </button>

      {state.message && (
        <p
          aria-live="polite"
          className={`text-sm ${state.isError ? "text-red-700" : "text-green-800"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
