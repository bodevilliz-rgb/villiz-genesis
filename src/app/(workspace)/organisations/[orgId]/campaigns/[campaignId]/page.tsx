import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireContext } from "@/server/container";
import { getCampaignOverview } from "@/core/application/use-cases/campaigns";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignTimeline } from "@/components/campaigns/campaign-timeline";
import { CampaignArchiveButton } from "@/components/campaigns/campaign-archive-button";
import { CampaignBulkScheduler } from "@/components/campaigns/campaign-bulk-scheduler";
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import { CAMPAIGN_PLATFORM_LABELS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/core/domain/entities/campaign";
import { formatDate, formatNumber } from "@/lib/format";
import { CampaignAssetsPanel } from "@/components/campaigns/campaign-assets-panel";
import { routes } from "@/lib/routes";

export default async function CampaignDetailPage({ params }: { params: Promise<{ orgId: string; campaignId: string }> }) {
  const { orgId, campaignId } = await params;
  const context = await requireContext();
  const campaignDeps = { actor: context.actor, campaigns: context.campaigns, content: context.content, organisations: context.organisations };
  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };

  // Campaign pages should scale with the campaign, not with the client's entire media library.
  // Load campaign-bound media first; a failure to enumerate unrelated library assets must not crash the campaign.
  const [overview, viewerRole, membrainOverview, attachedAssets] = await Promise.all([
    getCampaignOverview(campaignDeps, orgId, campaignId).catch(() => null),
    context.organisations.viewerRole(orgId),
    getMembrainOverview(membrainDeps, orgId),
    context.media.listAssetsForCampaign(campaignId),
  ]);
  if (!overview) notFound();

  // The link-asset picker is helpful but non-critical. Keep it bounded so adding campaign graphics
  // cannot make every page render mint signed URLs for an unbounded organisation library.
  const libraryPage = await context.media.listAssetsPage(orgId, { limit: 100, offset: 0, isArchived: false }).catch(() => null);
  const allAssets = libraryPage?.items ?? attachedAssets;
  const previewAssets = new Map([...allAssets, ...attachedAssets].map((asset) => [asset.id, asset]));
  const signedUrls: Record<string, string> = {};
  await Promise.all(Array.from(previewAssets.values()).filter((asset) => asset.mimeType.startsWith("image/")).map(async (asset) => {
    try { signedUrls[asset.storagePath] = await context.storage.getSignedUrl(asset.storagePath); } catch {}
  }));

  const { campaign, draftCounts } = overview;
  const canWrite = canWriteContent(context.actor, viewerRole);
  const canArchive = canEditOrganisation(context.actor, viewerRole);

  return <div className="flex flex-col gap-6">
    <PageHeader eyebrow="Campaigns" title={campaign.name} description={campaign.objective ?? undefined} actions={<div className="flex items-center gap-2">
      <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
      {canWrite ? <Button asChild variant="secondary" size="sm"><Link href={routes.organisations.campaigns.edit(orgId, campaignId)}><Pencil aria-hidden />Edit</Link></Button> : null}
      {canArchive && campaign.status !== "archived" ? <CampaignArchiveButton organisationId={orgId} campaignId={campaignId} name={campaign.name} /> : null}
    </div>} />

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-6">
        <Card><CardHeader><CardTitle>Timeline</CardTitle></CardHeader><CardContent>
          <CampaignTimeline startDate={campaign.startDate} endDate={campaign.endDate} />
          {campaign.startDate || campaign.endDate ? <p className="mt-2 text-[12px] text-subtle-foreground">{campaign.startDate ? formatDate(campaign.startDate) : "No start date"} – {campaign.endDate ? formatDate(campaign.endDate) : "No end date"}</p> : null}
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Campaign summary</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">
          <Detail label="Objective" value={campaign.objective} /><Detail label="Target audience" value={campaign.targetAudience} /><Detail label="Primary call to action" value={campaign.primaryCTA} /><Detail label="Success metric" value={campaign.successMetric} />
          <div><p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle-foreground">Platforms</p>{campaign.platforms.length > 0 ? <div className="flex flex-wrap gap-1.5">{campaign.platforms.map((platform) => <Badge key={platform} tone="muted">{CAMPAIGN_PLATFORM_LABELS[platform]}</Badge>)}</div> : <p className="text-[13px] text-subtle-foreground">None set</p>}</div>
          {campaign.description ? <div><p className="mb-1 text-[11px] uppercase tracking-wider text-subtle-foreground">Description</p><p className="knowledge-body text-[13px] text-muted-foreground">{campaign.description}</p></div> : null}
        </CardContent></Card>

        <CampaignAssetsPanel organisationId={orgId} campaignId={campaignId} allAssets={allAssets} attachedAssets={attachedAssets} signedUrls={signedUrls} canWrite={canWrite} />
        <CampaignBulkScheduler organisationId={orgId} campaignId={campaignId} campaignPlatforms={campaign.platforms} campaignStartDate={campaign.startDate} attachedAssets={attachedAssets} signedUrls={signedUrls} canWrite={canWrite} />
      </div>

      <div className="flex flex-col gap-4">
        <Card><CardHeader><CardTitle>Drafts</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3"><Stat label="Draft" value={formatNumber(draftCounts.draft)} /><Stat label="Needs review" value={formatNumber(draftCounts.inReview)} /><Stat label="Approved" value={formatNumber(draftCounts.approved)} /><Stat label="Total" value={formatNumber(draftCounts.total)} /></CardContent></Card>
        <Card><CardHeader><CardTitle>MemBrain readiness</CardTitle></CardHeader><CardContent className="flex flex-col gap-2"><Stat label="Readiness" value={`${membrainOverview.readiness.percentage}%`} detail="Applies to this whole client, not just this campaign" /><Button asChild variant="ghost" size="sm"><Link href={routes.organisations.membrain.index(orgId)}>Open MemBrain</Link></Button></CardContent></Card>
      </div>
    </div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return <div><p className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</p><p className={`mt-0.5 text-[13px] ${value ? "" : "text-subtle-foreground"}`}>{value ?? "Not set"}</p></div>;
}
