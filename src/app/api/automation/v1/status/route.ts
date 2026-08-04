import { NextResponse, type NextRequest } from "next/server";
import { getAutomationStatus } from "@/core/application/use-cases/automation";
import { SupabaseAutomationRepository } from "@/infrastructure/repositories/supabase-automation-repository";
import { automationAuthFailure } from "@/server/automation-auth";

export async function GET(request: NextRequest) {
  const failure = automationAuthFailure(request);
  if (failure) return failure;

  try {
    const snapshot = await getAutomationStatus(new SupabaseAutomationRepository());
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[genesis] automation status failed", error);
    return NextResponse.json({ error: "Automation status unavailable." }, { status: 500 });
  }
}
