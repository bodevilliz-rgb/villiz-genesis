import { NextResponse, type NextRequest } from "next/server";
import { getRequestContext } from "@/server/container";
import { retrieveContext } from "@/core/application/use-cases/membrain";
import { isDomainError } from "@/core/domain/errors";

/**
 * MemBrain retrieval endpoint.
 *
 * Exists so that automation outside the Next.js render tree — the n8n
 * workflows Villiz already runs, and the Content Studio generation service in
 * Sprint 2 — can consume the same knowledge through the same use case rather
 * than querying tables directly and drifting from the ranking rules.
 *
 * Authentication is the operator's own session cookie, so retrieval is subject
 * to exactly the same RLS as the UI. There is no service-role path here.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await getRequestContext();

  if (!context) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  try {
    const pack = await retrieveContext(
      { actor: context.actor, membrain: context.membrain, organisations: context.organisations },
      {
        organisationId: orgId,
        query: searchParams.get("q") ?? undefined,
        limit: searchParams.get("limit") ?? 12,
        maxCharacters: searchParams.get("maxCharacters") ?? 24000,
        recordUsage: searchParams.get("record") !== "false",
      },
    );

    return NextResponse.json(
      {
        organisationId: pack.organisationId,
        query: pack.query,
        estimatedTokens: pack.estimatedTokens,
        truncated: pack.truncated,
        entries: pack.items.map((item) => ({
          id: item.id,
          title: item.title,
          category: item.categoryKey,
          importance: item.importance,
          version: item.version,
        })),
        prompt: pack.prompt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[genesis] context retrieval failed", error);
    return NextResponse.json({ error: "Retrieval failed." }, { status: 500 });
  }
}
