// The sign-in link in the login email lands here.
// Supabase's default email contains a link (not a code) until we set up our
// own email sender (ROADMAP M1, custom SMTP). This handles both link styles:
//   ?code=...                 (default link, PKCE flow)
//   ?token_hash=...&type=...  (custom templates, later)
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  let ok = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  // Never redirect to an address taken from the link: always our own pages.
  return NextResponse.redirect(new URL(ok ? "/" : "/login?link=invalid", origin));
}
