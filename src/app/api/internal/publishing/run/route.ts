import "server-only";
import { type NextRequest, NextResponse } from "next/server";

// Retired: publishing is owned by scripts/publishing-worker.ts and its fenced
// submission path. This route must never construct worker dependencies.
export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { status: "disabled", error: "Publishing endpoint retired" },
    { status: 410 },
  );
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { status: "disabled", error: "Publishing endpoint retired" },
    { status: 410 },
  );
}
