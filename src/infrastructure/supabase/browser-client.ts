"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Browser-side Supabase client — exists solely so the media upload flow can
 * PUT file bytes directly into the private storage bucket with a signed
 * upload token (uploadToSignedUrl), bypassing Vercel's 4.5 MB serverless
 * request-body ceiling. The token — issued server-side per authenticated,
 * organisation-checked request for one exact path — is the write
 * authorisation; the anon key alone grants nothing.
 *
 * Not for data access: queries, mutations, and auth flows stay on the
 * server through the request-scoped client in server-client.ts.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
