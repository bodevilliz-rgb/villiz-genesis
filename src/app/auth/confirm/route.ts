import { NextResponse, type NextRequest } from "next/server";
import { createGenesisClient } from "@/infrastructure/supabase/server-client";
import { resolveSafeNextPath } from "@/lib/routes";

/**
 * Token-hash magic-link completion.
 *
 * Supabase's PKCE callback flow completes sign-in with a verifier stored in
 * the REQUESTING browser's cookie jar, so a link requested on one device (or
 * inside one mail app) fails when opened in another. The token-hash flow
 * removes that dependence entirely: the email links here carrying the
 * one-time `token_hash` in the query, and verifyOtp() consumes it server-side
 * against the Supabase project itself. Any browser, any device, any in-app
 * viewer works.
 *
 * Error policy matches /auth/callback: provider detail (invalid/used/expired
 * token) is never exposed — every failure redirects to the generic expired
 * page so an attacker cannot distinguish consumed codes from wrong ones.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const next = resolveSafeNextPath(searchParams.get("next"));

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/auth/error?reason=expired`);
  }

  const supabase = await createGenesisClient();
  const { error, data } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/auth/error?reason=expired`);
  }

  // Non-blocking: a failed heartbeat must never block a sign-in.
  await supabase
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.user.id);

  return NextResponse.redirect(`${origin}${next}`);
}