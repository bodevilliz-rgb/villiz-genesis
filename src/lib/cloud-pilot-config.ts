import "server-only";

/**
 * CLOUD_PILOT_SELF_APPROVAL — a single-purpose, cloud-pilot-only escape
 * hatch. The cloud pilot currently has exactly one staff member (the
 * bootstrapped Owner), so the review workflow's ordinary self-approval
 * prevention (see canApproveOwnAuthorship in
 * core/domain/entities/review.ts) makes end-to-end publishing impossible:
 * there is no one else who could ever approve their own draft.
 *
 * Deliberately read directly and permissively — like blotato-config.ts,
 * not through src/lib/env.ts's strict zod schema — so an unset flag is just
 * "disabled", never a build-breaking error. This is one of several
 * independent conditions the review use-case checks before bypassing
 * self-approval; see isSoleOwnerPilotOrganisation in
 * core/domain/entities/review.ts for the organisation-membership half of
 * that check.
 */
export function isCloudPilotSelfApprovalEnabled(): boolean {
  return process.env.CLOUD_PILOT_SELF_APPROVAL === "true";
}

// `new URL(...).hostname` returns an IPv6 literal with its brackets intact
// (e.g. "[::1]", not "::1") — both forms are listed so the loopback address
// is actually caught either way.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * The same "is this a real cloud Supabase project" predicate dev-cloud.js,
 * cloud-check.ts, and worker-publishing-cloud.ts already enforce as a
 * startup guard for those standalone scripts — reused here so the
 * application layer itself (not just the launch scripts) can tell cloud
 * apart from local at runtime.
 */
export function isCloudSupabaseUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && !LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase()) && !parsed.hostname.endsWith(".local");
}

export function isCloudEnvironment(): boolean {
  return isCloudSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}
