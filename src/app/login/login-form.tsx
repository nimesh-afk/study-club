"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {
  step: "email",
  email: "",
  message: "",
  isError: false,
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 px-4 py-3 text-base outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";
const primaryButton =
  "w-full rounded-lg bg-zinc-900 px-4 py-3 text-base font-medium text-white disabled:opacity-50";
const linkButton = "text-sm text-zinc-600 underline underline-offset-4";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    loginAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      {state.step === "email" ? (
        <>
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            defaultValue={state.email}
            className={inputClass}
          />
          <button
            type="submit"
            name="intent"
            value="send"
            disabled={pending}
            className={primaryButton}
          >
            {pending ? "Sending…" : "Email me a code"}
          </button>
        </>
      ) : (
        <>
          <input type="hidden" name="email" value={state.email} />
          <p className="text-sm text-zinc-600">
            Code sent to <span className="font-medium">{state.email}</span>
          </p>
          <label htmlFor="code" className="text-sm font-medium">
            Code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={12}
            required
            autoFocus
            className={`${inputClass} tracking-widest`}
          />
          <button
            type="submit"
            name="intent"
            value="verify"
            disabled={pending}
            className={primaryButton}
          >
            {pending ? "Checking…" : "Log in"}
          </button>
          <div className="flex justify-between">
            <button
              type="submit"
              name="intent"
              value="send"
              formNoValidate
              disabled={pending}
              className={linkButton}
            >
              Send a new code
            </button>
            <button
              type="submit"
              name="intent"
              value="restart"
              formNoValidate
              disabled={pending}
              className={linkButton}
            >
              Use a different email
            </button>
          </div>
        </>
      )}

      {state.message && (
        <p
          aria-live="polite"
          className={`text-sm ${state.isError ? "text-red-700" : "text-zinc-700"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
