import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { requireContext } from "@/server/container";
import { getDraft, getLatestGenerationRequest } from "@/core/application/use-cases/content";
import { getGenerationReadiness } from "@/core/application/use-cases/generation";
import { getEngagementLearningOverview, getLatestEngagementRecommendation } from "@/core/application/use-cases/engagement";
import { canBypassSelfApprovalForCloudPilot, getReviewHistory, listEligibleReviewers } from "@/core/application/use-cases/review";
import { PageHeader } from "@/components/common/page-header";
import { DraftForm } from "@/components/content/draft-form";
import { ReviewPanel } from "@/components/content/review-panel";
import { PublishingPanel } from "@/components/content/publishing-panel";
import { ReviewHistoryTimeline } from "@/components/content/review-history-timeline";
import { GenerationReadinessPanel } from "@/components/content/generation-readiness-panel";
import { EngagementIntelligencePanel } from "@/components/content/engagement-intelligence-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import { isContentDraftLocked } from "@/core/domain/entities/content";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { routes } from "@/lib/routes";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";

export default async function DraftDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; draftId: string }>;
}) {
  const { orgId, draftId } = await params;
  const context = await requireContext();

  const deps = {
    actor: context.actor,
    content: context.content,
    membrain: context.membrain,
    campaigns: context.campaigns,
    organisations: context.organisations,
    reviews: context.reviews,
  };

  const [draft, viewerRole] = await Promise.all([
    getDraft(deps, orgId, draftId).catch(() => null),
    context.organisations.viewerRole(orgId),
  ]);

  if (!draft) notFound();

  const [categories, campaigns, latestRequest, readiness, latestEngagementRecommendation, reviewHistory, eligibleReviewers, allAssets, attachedAssets, canSelfApproveInCloudPilot, channels] =
    await Promise.all([
      context.membrain.listCategories(orgId),
      context.campaigns.listCampaigns({ organisationId: orgId, limit: 100, offset: 0 }),
      getLatestGenerationRequest(deps, orgId, draftId),
      getGenerationReadiness(deps, orgId, draftId),
      getLatestEngagementRecommendation(
        { actor: context.actor, organisations: context.organisations, engagement: context.engagement },
        orgId,
        draftId,
      ),
      getReviewHistory(deps, orgId, draftId),
      listEligibleReviewers(deps, orgId),
      context.media.listAssets(orgId),
      context.media.listAssetsForDraft(draftId),
      canBypassSelfApprovalForCloudPilot({ actor: context.actor, organisations: context.organisations }, orgId),
      context.blotatoAccounts.listActiveForOrganisation(orgId).catch(() => []),
    ]);

  const isLivePublishing = blotatoConfig().livePublishingEnabled;

  const signedUrls: Record<string, string> = {};
  for (const asset of allAssets) {
    if (asset.mimeType.startsWith("image/")) {
      try {
        const signedUrl = await context.storage.getSignedUrl(asset.storagePath);
        signedUrls[asset.storagePath] = signedUrl;
      } catch {}
    }
  }

  const canWrite = canWriteContent(context.actor, viewerRole);
  const canLead = canEditOrganisation(context.actor, viewerRole);
  const linkedCampaign = draft.campaign ? campaigns.find((campaign) => campaign.id === draft.campaign?.id) : null;
  const knownPlatforms = new Set<CampaignPlatform>([
    "instagram",
    "facebook",
    "linkedin",
    "x",
    "tiktok",
    "youtube",
    "pinterest",
    "threads",
  ]);
  const scheduledPlatform = draft.scheduledPlatform as CampaignPlatform | null;
  const initialEngagementPlatform =
    (scheduledPlatform && knownPlatforms.has(scheduledPlatform) ? scheduledPlatform : null) ??
    linkedCampaign?.platforms[0] ??
    "instagram";
  const initialLearningOverview = await getEngagementLearningOverview({
    actor: context.actor,
    organisations: context.organisations,
    engagement: context.engagement,
    blotatoAccounts: context.blotatoAccounts,
  }, {
    organisationId: orgId,
    draftId,
    platform: latestEngagementRecommendation?.platform ?? initialEngagementPlatform,
    objectiveType: latestEngagementRecommendation?.objectiveType ?? "engagement",
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Content Studio · v${draft.version}`}
        title={draft.title}
        description={draft.summary ?? undefined}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={routes.organisations.content.history(orgId, draftId)}>
              <History aria-hidden />
              History
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="py-6">
            <DraftForm
              organisationId={orgId}
              categories={categories}
              campaigns={campaigns}
              draft={draft}
              locked={isContentDraftLocked(draft.status)}
              allAssets={allAssets}
              attachedAssets={attachedAssets}
              signedUrls={signedUrls}
              canDetachPublishedMedia={canLead && draft.status === "published"}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
            </CardHeader>
            <CardContent>
              <ReviewPanel
                organisationId={orgId}
                draft={draft}
                eligibleReviewers={eligibleReviewers}
                actorId={context.actor.id}
                canWrite={canWrite}
                canLead={canLead}
                canSelfApproveInCloudPilot={canSelfApproveInCloudPilot}
              />
            </CardContent>
          </Card>

          <EngagementIntelligencePanel
            organisationId={orgId}
            draftId={draftId}
            currentDraftVersion={draft.version}
            initialPlatform={initialEngagementPlatform}
            initialRecommendation={latestEngagementRecommendation}
            initialLearningOverview={initialLearningOverview}
            canWrite={canWrite}
          />

          <Card>
            <CardHeader>
              <CardTitle>Publishing & Scheduling</CardTitle>
            </CardHeader>
            <CardContent>
              <PublishingPanel
                organisationId={orgId}
                draft={draft}
                canWrite={canWrite}
                channels={channels}
                isLivePublishing={isLivePublishing}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Generation readiness</CardTitle>
            </CardHeader>
            <CardContent>
              <GenerationReadinessPanel
                organisationId={orgId}
                draftId={draftId}
                categories={categories}
                latestRequest={latestRequest}
                readiness={readiness}
                canWrite={canWrite}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Review history</CardTitle>
            </CardHeader>
            <CardContent>
              <ReviewHistoryTimeline history={reviewHistory} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
