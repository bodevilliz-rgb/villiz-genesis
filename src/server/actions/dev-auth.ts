"use server";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { createGenesisClient } from "@/infrastructure/supabase/server-client";
import { routes } from "@/lib/routes";
import { errorState, type ActionState } from "../action-result";

/**
 * Development-only sign-in shortcut.
 *
 * Skips waiting on a magic-link email during local development by generating
 * one server-side and verifying it immediately with the same GoTrue call a
 * real magic-link click resolves to. Note this deliberately does NOT reuse
 * `/auth/callback` (which expects a PKCE `code` from a browser-initiated
 * `signInWithOtp` call): an admin-generated link carries a `hashed_token`
 * instead, consumed via `verifyOtp`, not `exchangeCodeForSession`. Both paths
 * end at the same place — a real session written through the same
 * cookie-bound Supabase client every other request uses — so there is no new
 * session-handling logic here, just a different, equally standard Supabase
 * API for the one case (admin-generated links) that isn't a PKCE code.
 *
 * Impossible to reach outside local development, by two independent checks:
 *   - `NODE_ENV` must be "development" — Next.js bakes `NODE_ENV=production`
 *     into every production build; this branch cannot exist in a shipped bundle.
 *   - `ENABLE_DEV_LOGIN` must be the literal string "true" in `.env.local`,
 *     an opt-in with no default and no `NEXT_PUBLIC_` equivalent, so it is
 *     never bundled to the client and never on by simply running `next dev`
 *     without deliberately adding the line.
 * Both are re-checked here even though the login page already hides the
 * button unless both hold, so calling this action directly bypasses nothing.
 */
export async function devSignIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (process.env.NODE_ENV !== "development" || process.env.ENABLE_DEV_LOGIN !== "true") {
    return errorState(new Error("Development sign-in is disabled."));
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return errorState(new Error("Choose an account."));

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
    return errorState(error);
  }

  // Outside the try/catch deliberately: redirect() throws internally, and
  // catching that throw would misreport a successful sign-in as an error.
  redirect(routes.dashboard);
}
