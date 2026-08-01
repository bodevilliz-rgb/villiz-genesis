import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { DRAFT_SELECT } from "@/infrastructure/repositories/supabase-content-repository";
import { toDraft, type DraftRowWithRelations } from "@/infrastructure/mappers/content-mapper";
import { CompareWorkspaceClient } from "./compare-client";

export const metadata: Metadata = { title: "Version Comparison" };

export default async function CompareVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ reviewId: string }>;
  searchParams: Promise<{ v1?: string; v2?: string }>;
}) {
  const { reviewId } = await params;
  const query = await searchParams;
  const context = await requireContext();

  // 1. Fetch draft globally using RLS
  const { data: draftData, error } = await context.client
    .from("content_drafts")
    .select(DRAFT_SELECT)
    .eq("id", reviewId)
    .maybeSingle();

  if (error || !draftData) {
    notFound();
  }

  const draft = toDraft(draftData as unknown as DraftRowWithRelations);

  // 2. Fetch versions
  const versions = await context.content.listVersions(draft.organisationId, draft.id);

  if (versions.length === 0) {
    notFound();
  }

  // 3. Resolve compared version numbers
  const ver2Num = query.v2 ? parseInt(query.v2) : versions[0]?.version || 1;
  const ver1Num = query.v1 ? parseInt(query.v1) : versions[1]?.version || ver2Num - 1 || 1;

  const v1 = (versions.find((v) => v.version === ver1Num) || versions[versions.length - 1] || versions[0])!;
  const v2 = (versions.find((v) => v.version === ver2Num) || versions[0])!;

  return (
    <CompareWorkspaceClient
      draft={draft}
      versions={versions}
      v1={v1}
      v2={v2}
    />
  );
}
