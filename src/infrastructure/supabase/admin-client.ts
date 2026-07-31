import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Permitted uses are deliberately narrow and must stay that way:
 *   - inviting Villiz staff (writes to auth.users)
 *   - platform administration scripts
 *   - the development-only sign-in shortcut (src/server/actions/dev-auth.ts),
 *     itself gated so it can never run outside local development
 *
 * It must never be used to serve a page or fulfil a user-supplied filter.
 */
export function createAdminClient() {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
