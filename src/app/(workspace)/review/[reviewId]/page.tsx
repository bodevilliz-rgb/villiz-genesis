import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { DRAFT_SELECT } from "@/infrastructure/repositories/supabase-content-repository";
import { toDraft, type DraftRowWithRelations } from "@/infrastructure/mappers/content-mapper";
import { ReviewWorkspaceClient } from "./workspace-client";
import { canUseSoloOperatorApproval } from "@/core/application/use-cases/review";

export const metadata: Metadata = { title: "Review Workspace" };

export default async function ReviewWorkspacePage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
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

  // 3. Fetch threaded comments
  const comments = await context.reviews.listComments(draft.organisationId, draft.id);

  // 4. Fetch audit trail logs
  const auditLogs = await context.audits.listEventsForDraft(draft.organisationId, draft.id);

  // 5. Fetch organization members for reviewer assignment
  const members = await context.organisations.listMembers(draft.organisationId);
  const mappedMembers = members.map((m) => ({
    id: m.profile.id,
    fullName: m.profile.fullName,
    email: m.profile.email,
  }));

  // 6. Find current user's role in this organisation
  const organisations = await context.organisations.listForActor();
  const currentOrg = organisations.find((o) => o.id === draft.organisationId);
  const viewerRole = currentOrg?.viewerRole || "viewer";
  const soloOperatorApproval = await canUseSoloOperatorApproval(
    { actor: context.actor, organisations: context.organisations },
    draft.organisationId,
  );

  return (
    <ReviewWorkspaceClient
      draft={draft}
      versions={versions}
      comments={comments}
      auditLogs={auditLogs}
      members={mappedMembers}
      viewerRole={viewerRole}
      actorId={context.actor.id}
      soloOperatorApproval={soloOperatorApproval}
    />
  );
}
