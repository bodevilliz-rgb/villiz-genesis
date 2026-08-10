import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { collectEngagementAnalytics } from "@/core/application/use-cases/engagement/collector";
import { HttpBlotatoClient } from "@/infrastructure/blotato/http-blotato-client";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { SupabaseEngagementRepository } from "@/infrastructure/repositories/supabase-engagement-repository";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.PUBLISHING_WORKER_SECRET;
  const authorization = request.headers.get("authorization");
  return Boolean(secret && secret.length >= 16 && authorization === `Bearer ${secret}`);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const result = await collectEngagementAnalytics({
    publishing: new SupabasePublishingRepository(admin),
    engagement: new SupabaseEngagementRepository(admin),
    blotatoClient: new HttpBlotatoClient(blotatoConfig().apiKey),
  });
  return NextResponse.json(result);
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}

