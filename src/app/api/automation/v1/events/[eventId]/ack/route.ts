import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { acknowledgeAutomationEvent } from "@/core/application/use-cases/automation";
import { SupabaseAutomationRepository } from "@/infrastructure/repositories/supabase-automation-repository";
import { automationAuthFailure } from "@/server/automation-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const failure = automationAuthFailure(request);
  if (failure) return failure;

  try {
    const { eventId } = await params;
    const body = await request.json();
    const acknowledged = await acknowledgeAutomationEvent(new SupabaseAutomationRepository(), {
      eventId,
      consumer: body.consumer,
      leaseToken: body.leaseToken,
    });
    if (!acknowledged) {
      return NextResponse.json({ error: "Event lease is invalid, expired, or already acknowledged." }, { status: 409 });
    }
    return NextResponse.json({ acknowledged: true });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid acknowledgement request.", issues: error.flatten() }, { status: 400 });
    }
    console.error("[genesis] automation acknowledgement failed", error);
    return NextResponse.json({ error: "Event acknowledgement failed." }, { status: 500 });
  }
}
