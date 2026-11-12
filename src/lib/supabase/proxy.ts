// Helper used by src/proxy.ts to refresh the user's Supabase session on each request.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Pass refreshed cookies to Server Components (request)...
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          // ...and to the browser (response).
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // Cache headers stop a CDN from caching a response that carries a session.
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Don't add code between createServerClient and getClaims().
  // getClaims() validates the token and refreshes it if it has expired.
  await supabase.auth.getClaims();

  // Always return supabaseResponse (it carries the refreshed cookies).
  // If you ever return a different response, copy its cookies and headers first.
  return supabaseResponse;
}
