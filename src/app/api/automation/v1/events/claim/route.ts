import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { claimAutomationEvents } from "@/core/application/use-cases/automation";
import { SupabaseAutomationRepository } from "@/infrastructure/repositories/supabase-automation-repository";
import { automationAuthFailure } from "@/server/automation-auth";

export async function POST(request: NextRequest) {
  const failure = automationAuthFailure(request);
  if (failure) return failure;

  try {
    const events = await claimAutomationEvents(new SupabaseAutomationRepository(), await request.json());
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid claim request.", issues: error.flatten() }, { status: 400 });
    }
    console.error("[genesis] automation claim failed", error);
    return NextResponse.json({ error: "Event claim failed." }, { status: 500 });
  }
}
