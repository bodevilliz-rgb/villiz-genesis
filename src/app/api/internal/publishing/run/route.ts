import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";
import { SupabaseBlotatoAccountRepository } from "@/infrastructure/repositories/supabase-blotato-account-repository";
import { SupabaseContentRepository } from "@/infrastructure/repositories/supabase-content-repository";
import { SupabaseAuditRepository } from "@/infrastructure/repositories/supabase-audit-repository";
import { SupabaseNotificationRepository } from "@/infrastructure/repositories/supabase-notification-repository";
import { SupabaseMediaRepository } from "@/infrastructure/repositories/supabase-media-repository";
import { SupabaseStoragePort } from "@/infrastructure/ports/supabase-storage-port";
import { HttpBlotatoClient } from "@/infrastructure/blotato/http-blotato-client";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { runPublishingWorkerIteration } from "@/core/application/use-cases/publishing/worker";

/**
 * POST /api/internal/publishing/run
 *
 * Triggers one iteration of the publishing worker. Intended for:
 *   - Controlled integration testing in development
 *   - Manual intervention when a cron is not yet wired
 *   - The future Vercel Cron route (Sprint 10B) that will call this on a schedule
 *
 * Protected by PUBLISHING_WORKER_SECRET — must be presented as:
 *   Authorization: Bearer <secret>
 *
 * The secret is read server-side from process.env and is NEVER exposed via
 * NEXT_PUBLIC_ or any client-side bundle. An unconfigured secret returns 401
 * for all requests (fail-closed: an unguarded endpoint is worse than a
 * broken one).
 *
 * Uses the service-role (admin) Supabase client — bypasses RLS by design.
 * publishing_attempts grants no INSERT/UPDATE to `authenticated` at all;
 * only the service-role client can write attempt rows. See the publishing
 * engine migration comment for the full rationale.
 *
 * Response shapes:
 *   { "status": "idle" }
 *   { "status": "processed", "jobId": "...", "result": "published", "externalUrl": "..." }
 *   { "status": "processed", "jobId": "...", "result": "failed", "failureCode": "..." }
 *
 * Sensitive provider payloads (Blotato submission ids, media URLs) are never
 * included in the response — only the outcome and enough context to diagnose.
 */

function resolveWorkerSecret(): string | undefined {
  return process.env.PUBLISHING_WORKER_SECRET;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = resolveWorkerSecret();
  if (!secret || secret.length < 16) {
    // Unconfigured or too-short secret → fail-closed for all requests.
    return false;
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === secret;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const config = blotatoConfig();

  const deps = {
    publishing: new SupabasePublishingRepository(adminClient),
    content: new SupabaseContentRepository(adminClient),
    blotatoAccounts: new SupabaseBlotatoAccountRepository(adminClient),
    audits: new SupabaseAuditRepository(adminClient),
    notifications: new SupabaseNotificationRepository(adminClient),
    blotatoClient: new HttpBlotatoClient(config.apiKey),
    media: new SupabaseMediaRepository(adminClient),
    storage: new SupabaseStoragePort(adminClient),
  };

  const result = await runPublishingWorkerIteration(deps);
  return NextResponse.json(result);
}

// Only POST — reject GET/HEAD/etc. with 405 to prevent accidental triggering
// via browser navigation or health-check scanners.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
