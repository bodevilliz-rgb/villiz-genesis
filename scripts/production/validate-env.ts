/**
 * Sprint 8.0 — pure validation logic for `npm run production:check`.
 *
 * Kept separate from the CLI entrypoint (production-check.ts) specifically
 * so it can be unit-tested directly with a plain object, the same
 * convention the rest of this repo already uses for pure application logic
 * (e.g. computePublishingAnalytics). Never reads process.env itself — the
 * caller always passes the environment in explicitly.
 */
import { isCloudSupabaseUrl } from "@/lib/cloud-pilot-config";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

const LOCAL_SITE_URL_DEFAULTS = new Set(["http://localhost:3000", "http://localhost:3001"]);

/**
 * Reuses the exact same "is this really a cloud, non-local https URL"
 * predicate dev-cloud.js/cloud-check.ts/worker-publishing-cloud.ts already
 * enforce for Supabase URLs — the safety property (reject localhost/HTTP)
 * is identical for any production-facing URL, not just a Supabase one.
 */
function isSafeProductionUrl(rawUrl: string | undefined): boolean {
  return isCloudSupabaseUrl(rawUrl);
}

type Env = Record<string, string | undefined>;

export function validateProductionEnv(env: Env): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- NEXT_PUBLIC_SITE_URL ---------------------------------------------
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    errors.push("NEXT_PUBLIC_SITE_URL is not set. Magic-link sign-in emails would be built with env.ts's local-dev fallback (http://localhost:3000), which is unreachable for real users.");
  } else if (LOCAL_SITE_URL_DEFAULTS.has(siteUrl)) {
    errors.push(`NEXT_PUBLIC_SITE_URL is still "${siteUrl}" — the local development default. Set it to your real Vercel/custom production URL.`);
  } else if (!isSafeProductionUrl(siteUrl)) {
    errors.push(`NEXT_PUBLIC_SITE_URL ("${siteUrl}") must be a real https:// URL, not localhost or a .local hostname.`);
  }

  // --- NEXT_PUBLIC_SUPABASE_URL ------------------------------------------
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    errors.push("NEXT_PUBLIC_SUPABASE_URL is not set.");
  } else if (!isSafeProductionUrl(supabaseUrl)) {
    errors.push(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") does not look like a real cloud Supabase project (must be https://, not localhost/127.0.0.1/*.local).`);
  }

  // --- NEXT_PUBLIC_SUPABASE_ANON_KEY --------------------------------------
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim().length < 20) {
    errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or looks too short to be a real anon key.");
  }

  // --- SUPABASE_SERVICE_ROLE_KEY ------------------------------------------
  if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY.trim().length < 20) {
    errors.push("SUPABASE_SERVICE_ROLE_KEY is missing or looks too short to be a real service-role key. Server actions and the publishing worker cannot function without it.");
  }

  // --- Secret / public separation -----------------------------------------
  // No NEXT_PUBLIC_-prefixed variable may carry the same value as a
  // server-only secret — that would ship the secret straight to the
  // browser bundle, regardless of what the variable happens to be named.
  const secretValues = [env.SUPABASE_SERVICE_ROLE_KEY, env.BLOTATO_API_KEY].filter((v): v is string => Boolean(v && v.trim().length > 0));
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("NEXT_PUBLIC_") && value && secretValues.includes(value)) {
      errors.push(`${key} is a NEXT_PUBLIC_ variable but its value matches a server-only secret (SUPABASE_SERVICE_ROLE_KEY or BLOTATO_API_KEY) — this would expose that secret to every browser. Remove the NEXT_PUBLIC_ prefix or use a different value.`);
    }
  }

  // --- ALLOWED_EMAIL_DOMAINS -----------------------------------------------
  if (!env.ALLOWED_EMAIL_DOMAINS || env.ALLOWED_EMAIL_DOMAINS.trim().length === 0) {
    errors.push("ALLOWED_EMAIL_DOMAINS is not set — sign-in would fall back to env.ts's default (\"villiz.com\"), which may not be what you intend for this deployment. Set it explicitly.");
  }

  // --- ENABLE_DEV_LOGIN -----------------------------------------------------
  if (env.ENABLE_DEV_LOGIN === "true") {
    errors.push('ENABLE_DEV_LOGIN is "true". This must be "false" (or unset) in production — the route it gates is already inert whenever NODE_ENV isn\'t "development", but this flag should never be left on regardless.');
  }

  // --- CLOUD_PILOT_SELF_APPROVAL --------------------------------------------
  if (env.CLOUD_PILOT_SELF_APPROVAL === "true") {
    warnings.push(
      'CLOUD_PILOT_SELF_APPROVAL is "true" — the review workflow\'s self-approval prevention is bypassed for this deployment. Expected during the single-operator beta pilot; turn it back to "false" the moment a second approver exists in the pilot organisation.',
    );
  }

  // --- Blotato ----------------------------------------------------------
  const blotatoEnabled = env.BLOTATO_ENABLED === "true";
  if (blotatoEnabled && (!env.BLOTATO_API_KEY || env.BLOTATO_API_KEY.trim().length === 0)) {
    errors.push("BLOTATO_ENABLED is \"true\" but BLOTATO_API_KEY is not set — Test Connection and the worker's real publish path would both fail.");
  }
  if (env.BLOTATO_LIVE_PUBLISHING_ENABLED !== undefined && env.BLOTATO_LIVE_PUBLISHING_ENABLED !== "true" && env.BLOTATO_LIVE_PUBLISHING_ENABLED !== "false") {
    errors.push(`BLOTATO_LIVE_PUBLISHING_ENABLED must be exactly "true" or "false" if set, got "${env.BLOTATO_LIVE_PUBLISHING_ENABLED}".`);
  }
  if (env.BLOTATO_LIVE_PUBLISHING_ENABLED === "true") {
    warnings.push('BLOTATO_LIVE_PUBLISHING_ENABLED is "true" — the worker will submit real posts to Blotato. Confirm this is intentional before the hosted smoke test (see docs/HOSTED_SMOKE_TEST.md).');
  }

  return { errors, warnings };
}
