import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { collectEngagementAnalytics } from "@/core/application/use-cases/engagement/collector";
import { HttpBlotatoClient } from "@/infrastructure/blotato/http-blotato-client";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { SupabaseEngagementRepository } from "@/infrastructure/repositories/supabase-engagement-repository";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest, secretName: "CRON_SECRET" | "PUBLISHING_WORKER_SECRET"): boolean {
  const secret = process.env[secretName];
  const authorization = request.headers.get("authorization");
  return Boolean(secret && secret.length >= 16 && authorization === `Bearer ${secret}`);
}

async function runCollector(): Promise<NextResponse> {
  const admin = createAdminClient();
  const result = await collectEngagementAnalytics({
    publishing: new SupabasePublishingRepository(admin),
    engagement: new SupabaseEngagementRepository(admin),
    blotatoClient: new HttpBlotatoClient(blotatoConfig().apiKey),
  }, { limit: 50 });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request, "PUBLISHING_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCollector();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCollector();
}
