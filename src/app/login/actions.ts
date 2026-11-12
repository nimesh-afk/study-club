"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  step: "email" | "code";
  email: string;
  message: string;
  isError: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One action handles all three buttons on the login page:
//   intent=send    -> email a one-time code
//   intent=verify  -> check the code and log in
//   intent=restart -> go back and use a different email
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const intent = String(formData.get("intent") ?? "send");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (intent === "restart") {
    return { step: "email", email: "", message: "", isError: false };
  }

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return {
      step: "email",
      email,
      message: "Please enter a valid email address.",
      isError: true,
    };
  }

  const supabase = await createClient();

  if (intent === "verify") {
    const token = String(formData.get("code") ?? "").replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(token)) {
      return {
        step: "code",
        email,
        message: "Enter the code from the email (numbers only).",
        isError: true,
      };
    }

    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error) {
      return {
        step: "code",
        email,
        message: "That code didn't work or has expired. Check it, or ask for a new one.",
        isError: true,
      };
    }
    // Logged in. The home page sends each person to their own area.
    redirect("/");
  }

  // intent === "send"
  // shouldCreateUser: false -> this can never create an account.
  // Accounts are created only by an admin (invite-only, CLAUDE.md 1).
  // The email's sign-in link returns to /auth/callback on the site the person
  // is using (live site, a preview link, or localhost). Supabase only accepts
  // addresses on its allow-list (Authentication > URL Configuration).
  const origin = (await headers()).get("origin") ?? "";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
    },
  });

  // Don't reveal whether an email has an account: only rate limits get
  // their own message; every other outcome looks the same.
  if (error?.status === 429) {
    return {
      step: "email",
      email,
      message: "Too many attempts. Please wait a few minutes and try again.",
      isError: true,
    };
  }

  return {
    step: "code",
    email,
    message:
      "If this email belongs to a Study Club member, an email is on its way. Open its sign-in link on this device, in this browser. If the email shows a code instead, type it below.",
    isError: false,
  };
}
