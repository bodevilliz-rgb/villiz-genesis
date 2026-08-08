import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";
import { SupabaseBlotatoAccountRepository } from "@/infrastructure/repositories/supabase-blotato-account-repository";
import { SupabaseContentRepository } from "@/infrastructure/repositories/supabase-content-repository";
import { SupabaseAuditRepository } from "@/infrastructure/repositories/supabase-audit-repository";
import { SupabaseNotificationRepository } from "@/infrastructure/repositories/supabase-notification-repository";
import { HttpBlotatoClient } from "@/infrastructure/blotato/http-blotato-client";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { runPublishingWorkerIteration } from "@/core/application/use-cases/publishing/worker";

/**
 * GET /api/cron/publishing
 *
 * Sprint 10B — Vercel Cron entrypoint for the publishing worker.
 * Registered in vercel.json. Vercel invokes this on the configured schedule
 * (every minute on Pro, once per day on Hobby — see vercel.json comment).
 *
 * Authentication: Vercel automatically manages CRON_SECRET and sends it as
 *   Authorization: Bearer <CRON_SECRET>
 * Fail-closed: a missing or too-short secret → 401 for all requests so an
 * unconfigured deployment cannot become an unauthenticated publish trigger.
 *
 * One invocation = one runPublishingWorkerIteration call = at most one job
 * claimed and processed. Throughput is controlled by cron frequency
 * (vercel.json schedule), not by looping inside this handler. See worker.ts
 * for the rationale: single-job-per-invocation keeps failures bounded and
 * lets the DB's FOR UPDATE SKIP LOCKED be the only concurrency gate.
 *
 * Response shapes (same shape as the POST endpoint for log consistency):
 *   200 { "status": "idle" }                                  — no due job
 *   200 { "status": "processed", "jobId": "...",              — job completed
 *         "result": "published", "externalUrl": "..." }
 *   200 { "status": "processed", "jobId": "...",              — job failed
 *         "result": "failed", "failureCode": "..." }
 *   401 { "error": "Unauthorized" }
 *   405 { "error": "Method Not Allowed" }                     — non-GET
 *
 * Pre-live note: this route passes assetUrls:[] to the publisher (no media
 * resolution) — same as the POST endpoint. Simulation mode is unaffected.
 * Live Instagram publishing requires media; resolve that gap before enabling
 * BLOTATO_LIVE_PUBLISHING_ENABLED=true (tracked as PRE-LIVE blocker).
 */

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail-closed: reject all requests when the secret is absent or implausibly short.
  if (!secret || secret.length < 16) return false;
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === secret;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
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
  };

  const result = await runPublishingWorkerIteration(deps);
  return NextResponse.json(result);
}

// Reject non-GET methods — Vercel Cron only sends GET; anything else is an
// accidental or adversarial invocation.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}

export async function PUT(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}

export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
