import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { createGenesisClient } from "@/infrastructure/supabase/server-client";

/**
 * Non-interactive counterpart to `devSignIn` (src/server/actions/dev-auth.ts),
 * for tooling that needs a real authenticated session without driving a
 * browser — currently only `scripts/preview-check.js`'s health checks for the
 * routes that require sign-in. Same session-establishing call, same two gates;
 * see that file's doc comment for why an admin-generated link is verified
 * through `verifyOtp` rather than the PKCE `/auth/callback` exchange.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development" || process.env.ENABLE_DEV_LOGIN !== "true") {
    return NextResponse.json({ error: "Development sign-in is disabled." }, { status: 404 });
  }

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data?.properties?.hashed_token) {
      throw error ?? new Error("Could not generate a development sign-in link.");
    }

    const supabase = await createGenesisClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: "magiclink",
    });
    if (verifyError) throw verifyError;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
