import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { Database } from "./database.types";

export type GenesisClient = SupabaseClient<Database>;

/**
 * Request-scoped Supabase client bound to the user's session cookies.
 *
 * This is the ONLY client used for business data. It carries the caller's JWT,
 * which means every query is filtered by Row Level Security — the application
 * cannot accidentally read another organisation's rows even if a query is
 * written incorrectly.
 */
export async function createGenesisClient(): Promise<GenesisClient> {
  const cookieStore = await cookies();
  const env = serverEnv();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Session refresh is handled by
          // middleware, so this is safe to ignore.
        }
      },
    },
  });
}
