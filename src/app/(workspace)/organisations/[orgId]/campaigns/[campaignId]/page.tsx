import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Pencil, Sparkles, TrendingUp } from "lucide-react";
import { requireContext } from "@/server/container";
import { getCampaignOverview } from "@/core/application/use-cases/campaigns";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { getCampaignSchedule } from "@/server/queries/campaign-schedule";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignArchiveButton } from "@/components/campaigns/campaign-archive-button";
import { CampaignBulkScheduler } from "@/components/campaigns/campaign-bulk-scheduler";
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import { CAMPAIGN_PLATFORM_LABELS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/core/domain/entities/campaign";
import { formatNumber } from "@/lib/format";
import { CampaignAssetsPanel } from "@/components/campaigns/campaign-assets-panel";
import { routes } from "@/lib/routes";

export default async function CampaignDetailPage({ params }: { params: Promise<{ orgId: string; campaignId: string }> }) {
  const { orgId, campaignId } = await params;
  const context = await requireContext();
  const campaignDeps = { actor: context.actor, campaigns: context.campaigns, content: context.content, organisations: context.organisations };
  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const [overview, viewerRole, membrainOverview, attachedAssets, schedule] = await Promise.all([
    getCampaignOverview(campaignDeps, orgId, campaignId).catch(() => null), context.organisations.viewerRole(orgId), getMembrainOverview(membrainDeps, orgId), context.media.listAssetsForCampaign(campaignId), getCampaignSchedule(campaignId),
  ]);
  if (!overview) notFound();
  const libraryPage = await context.media.listAssetsPage(orgId, { limit: 100, offset: 0, isArchived: false }).catch(() => null);
  const allAssets = libraryPage?.items ?? attachedAssets;
  const previewAssets = new Map([...allAssets, ...attachedAssets].map(a => [a.id, a]));
  const signedUrls: Record<string,string> = {};
  await Promise.all(Array.from(previewAssets.values()).filter(a => a.mimeType.startsWith("image/")).map(async a => { try { signedUrls[a.storagePath] = await context.storage.getSignedUrl(a.storagePath); } catch {} }));
  const { campaign, draftCounts } = overview;
  const canWrite = canWriteContent(context.actor, viewerRole); const canArchive = canEditOrganisation(context.actor, viewerRole);
  const weeks = new Set(schedule.map(s => s.weekNumber)).size;
  const readySlots = schedule.filter(s => s.draftId).length;
  const nextSlots = schedule.slice(0, 4);

  return <div className="flex flex-col gap-6">
    <PageHeader eyebrow="Campaign command centre" title={campaign.name} description={campaign.objective ?? "Plan, optimise, approve and publish this campaign from one workspace."} actions={<div className="flex items-center gap-2"><Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>{canWrite?<Button asChild variant="secondary" size="sm"><Link href={routes.organisations.campaigns.edit(orgId,campaignId)}><Pencil aria-hidden/>Edit</Link></Button>:null}{canArchive&&campaign.status!=="archived"?<CampaignArchiveButton organisationId={orgId} campaignId={campaignId} name={campaign.name}/>:null}</div>}/>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Weekly assets" value={formatNumber(attachedAssets.length)} detail={weeks ? `${weeks} scheduled weeks` : "Ready for campaign planning"}/>
      <Stat label="Platform slots" value={formatNumber(schedule.length)} detail={schedule.length ? "Real schedule records" : "Build schedule to activate"}/>
      <Stat label="Awo-ready drafts" value={formatNumber(readySlots)} detail={`${draftCounts.approved} approved`}/>
      <Stat label="MemBrain" value={`${membrainOverview.readiness.percentage}%`} detail="Client intelligence readiness"/>
    </div>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)]">
      <div className="flex flex-col gap-6">
        <Card><CardHeader><CardTitle>Campaign operating brief</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Detail label="Objective" value={campaign.objective}/><Detail label="Target audience" value={campaign.targetAudience}/><Detail label="Primary CTA" value={campaign.primaryCTA}/><Detail label="Success metric" value={campaign.successMetric}/><div className="sm:col-span-2"><p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle-foreground">Platforms</p><div className="flex flex-wrap gap-1.5">{campaign.platforms.map(p=><Badge key={p} tone="muted">{CAMPAIGN_PLATFORM_LABELS[p]}</Badge>)}</div></div></CardContent></Card>
        <CampaignAssetsPanel organisationId={orgId} campaignId={campaignId} allAssets={allAssets} attachedAssets={attachedAssets} signedUrls={signedUrls} canWrite={canWrite}/>
        <CampaignBulkScheduler organisationId={orgId} campaignId={campaignId} campaignPlatforms={campaign.platforms} campaignStartDate={campaign.startDate} attachedAssets={attachedAssets} signedUrls={signedUrls} canWrite={canWrite}/>
      </div>
      <div className="flex flex-col gap-4">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-primary"/>Live schedule</CardTitle></CardHeader><CardContent className="flex flex-col gap-3">{nextSlots.length ? nextSlots.map(slot=><div key={slot.id} className="rounded-md border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium">Week {slot.weekNumber} · {CAMPAIGN_PLATFORM_LABELS[slot.platform]}</span><Badge tone={slot.draftId?"positive":"muted"}>{slot.draftId?"Awo ready":slot.status}</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">{slot.scheduledDate} · {slot.scheduledTime.slice(0,5)} · {slot.timezone}</p></div>) : <p className="text-[12px] text-muted-foreground">No schedule exists yet. Build the campaign schedule to create real platform slots.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary"/>Intelligence pipeline</CardTitle></CardHeader><CardContent className="space-y-3 text-[12px]"><p><strong>MemBrain:</strong> {membrainOverview.readiness.percentage}% ready</p><p><strong>Market Intelligence:</strong> supplied to every Awo generation request.</p><p><strong>Distribution Gate:</strong> required before approval/publishing.</p><Button asChild variant="secondary" size="sm"><Link href={routes.organisations.membrain.index(orgId)}>Open intelligence</Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="size-4 text-primary"/>Growth loop</CardTitle></CardHeader><CardContent><p className="text-[12px] text-muted-foreground">Published campaign performance feeds Growth so later content can improve from reach, engagement, enquiries and bookings.</p></CardContent></Card>
      </div>
    </div>
  </div>;
}
function Detail({label,value}:{label:string;value:string|null}){return <div><p className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</p><p className={`mt-1 text-[13px] ${value?"":"text-subtle-foreground"}`}>{value??"Not set"}</p></div>}
