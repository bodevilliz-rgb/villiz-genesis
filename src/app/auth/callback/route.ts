import { NextResponse, type NextRequest } from "next/server";
import { createGenesisClient } from "@/infrastructure/supabase/server-client";
import { resolveSafeNextPath } from "@/lib/routes";

/**
 * Magic-link exchange.
 *
 * The one-time code is swapped for a session server-side, so the tokens never
 * touch client JavaScript. `next` is validated as a same-origin relative path
 * to prevent the login flow being used as an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = resolveSafeNextPath(searchParams.get("next"));

  if (!code) {
    // Supabase Admin invitations use the implicit invite flow: after GoTrue
    // verifies the one-time token it redirects with the session in the URL
    // fragment. Fragments never reach a server route, so hand this request to
    // the client-only acceptance page. Browsers preserve the fragment across
    // this same-origin redirect. Ordinary Genesis magic links still arrive
    // with a PKCE `code` and continue through the unchanged path below.
    return NextResponse.redirect(`${origin}/auth/accept`);
  }

  const supabase = await createGenesisClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/auth/error?reason=expired`);
  }

  const { data } = await supabase.auth.getUser();
  if (data.user) {
    // Non-blocking: a failed heartbeat must never block a sign-in.
    await supabase
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", data.user.id);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
