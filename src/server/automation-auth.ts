import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

function equalSecret(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function automationAuthFailure(request: NextRequest): NextResponse | null {
  const expected = process.env.GENESIS_AUTOMATION_API_KEY?.trim();
  if (!expected || expected.length < 32) {
    return NextResponse.json({ error: "Automation gateway is not configured." }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const received = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!received || !equalSecret(received, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
