import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2, ChevronRight, Pencil, Sparkles, TrendingUp } from "lucide-react";
import { requireContext } from "@/server/container";
import { getCampaignOverview } from "@/core/application/use-cases/campaigns";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { getCampaignSchedule } from "@/server/queries/campaign-schedule";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignArchiveButton } from "@/components/campaigns/campaign-archive-button";
import { CampaignBulkScheduler } from "@/components/campaigns/campaign-bulk-scheduler";
import { CampaignAssetsPanel } from "@/components/campaigns/campaign-assets-panel";
import { CampaignAwoActions } from "@/components/campaigns/campaign-awo-actions";
import { CampaignPublicationLiveCard } from "@/components/campaigns/campaign-publication-live-card";
import { CampaignReviewGrid } from "@/components/campaigns/campaign-review-grid";
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import { CAMPAIGN_PLATFORM_LABELS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/core/domain/entities/campaign";
import { routes } from "@/lib/routes";

export default async function CampaignDetailPage({ params }: { params: Promise<{ orgId: string; campaignId: string }> }) {
  const { orgId, campaignId } = await params;
  const context = await requireContext();
  const campaignDeps = { actor: context.actor, campaigns: context.campaigns, content: context.content, organisations: context.organisations };
  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const [overview, viewerRole, membrainOverview, attachedAssets, schedule] = await Promise.all([
    getCampaignOverview(campaignDeps, orgId, campaignId).catch(() => null),
    context.organisations.viewerRole(orgId),
    getMembrainOverview(membrainDeps, orgId),
    context.media.listAssetsForCampaign(campaignId),
    getCampaignSchedule(campaignId),
  ]);
  if (!overview) notFound();

  const libraryPage = await context.media.listAssetsPage(orgId, { limit: 100, offset: 0, isArchived: false }).catch(() => null);
  const allAssets = libraryPage?.items ?? attachedAssets;
  const previewAssets = new Map([...allAssets, ...attachedAssets].map(a => [a.id, a]));
  const signedUrls: Record<string, string> = {};
  await Promise.all(Array.from(previewAssets.values()).filter(a => a.mimeType.startsWith("image/")).map(async a => {
    try { signedUrls[a.storagePath] = await context.storage.getSignedUrl(a.storagePath); } catch {}
  }));

  const { campaign, draftCounts } = overview;
  const canWrite = canWriteContent(context.actor, viewerRole);
  const canArchive = canEditOrganisation(context.actor, viewerRole);
  const weeks = new Set(schedule.map(s => s.weekNumber)).size;
  const preparedSlots = schedule.filter(s => s.draftId).length;
  const campaignDrafts = await Promise.all(schedule.filter(s => s.draftId).map(s => context.content.findDraft(orgId, s.draftId!)));
  const optimisedCount = campaignDrafts.filter(draft => draft && draft.body.trim().length > 0 && draft.hashtags.length > 0).length;
  const approved = draftCounts.approved;
  const nextSlot = schedule.find(slot => slot.status !== "published" && slot.status !== "cancelled") ?? null;
  const nextSlots = nextSlot ? schedule.filter(slot => slot.weekNumber === nextSlot.weekNumber && slot.scheduledDate === nextSlot.scheduledDate && slot.scheduledTime === nextSlot.scheduledTime && slot.timezone === nextSlot.timezone) : [];
  const nextDrafts = nextSlots.map(slot => campaignDrafts.find(draft => draft?.id === slot.draftId) ?? null);
  const nextOptimisedCount = nextDrafts.filter(draft => draft && draft.body.trim().length > 0 && draft.hashtags.length > 0).length;
  const nextApprovedCount = nextDrafts.filter(draft => draft && ["approved", "scheduled", "publishing", "published"].includes(draft.status)).length;
  const weekOne = schedule.filter(s => s.weekNumber === 1);
  const weekGroups = Array.from(new Set(schedule.map(s => s.weekNumber))).map(weekNumber => ({
    weekNumber,
    slots: schedule.filter(s => s.weekNumber === weekNumber),
    asset: attachedAssets.find(asset => {
      const name = asset.title || asset.fileName;
      return new RegExp(`week[\\s_-]*0*${weekNumber}(?:\\D|$)`, "i").test(name);
    }) ?? attachedAssets[weekNumber - 1] ?? null,
  }));
  const reviewWeeks = weekGroups.map(group => {
    const asset = group.asset;
    const slots = group.slots.map(slot => {
      const draft = campaignDrafts.find(item => item?.id === slot.draftId) ?? null;
      return {
        id: slot.id,
        platformLabel: CAMPAIGN_PLATFORM_LABELS[slot.platform],
        draftId: slot.draftId,
        draftStatus: draft?.status ?? null,
        body: draft?.body ?? "",
        hashtags: draft?.hashtags ?? [],
      };
    });
    return {
      weekNumber: group.weekNumber,
      assetLabel: asset?.title || asset?.fileName || "No asset",
      imageUrl: asset ? signedUrls[asset.storagePath] : undefined,
      optimised: slots.length === group.slots.length && slots.every(slot => slot.body.trim() && slot.hashtags.length),
      slots,
    };
  });

  return <div className="flex flex-col gap-6">
    <PageHeader eyebrow="Campaign command centre" title={campaign.name} description={campaign.objective ?? "Plan, optimise, approve and publish this campaign from one workspace."} actions={<div className="flex flex-wrap items-center gap-2">
      <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
      {canWrite ? <Button asChild variant="secondary" size="sm"><Link href={routes.organisations.campaigns.edit(orgId, campaignId)}><Pencil aria-hidden />Edit</Link></Button> : null}
      {canArchive && campaign.status !== "archived" ? <CampaignArchiveButton organisationId={orgId} campaignId={campaignId} name={campaign.name} /> : null}
    </div>} />

    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,.55fr)]">
        <div className="border-b border-border p-6 xl:border-b-0 xl:border-r">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2"><Badge tone="positive">Live campaign</Badge>{campaign.platforms.map(p => <Badge key={p} tone="muted">{CAMPAIGN_PLATFORM_LABELS[p]}</Badge>)}</div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">{weeks || attachedAssets.length} weeks · {schedule.length || attachedAssets.length * Math.max(campaign.platforms.length, 1)} platform posts</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Upload once. Awo generates platform-specific captions, hooks, CTAs and discovery hashtags from MemBrain and campaign intelligence.</p>
            </div>
            <div className="grid min-w-[280px] grid-cols-2 gap-2">
              <Metric label="Assets" value={String(attachedAssets.length)} detail="linked" />
              <Metric label="Slots" value={String(schedule.length)} detail="scheduled" />
              <Metric label="Prepared" value={`${preparedSlots}/${schedule.length || 0}`} detail="for Awo" />
              <Metric label="Optimised" value={`${optimisedCount}/${schedule.length || 0}`} detail="caption + hashtags" />
            </div>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <StatusStep title="1. Prepare" detail={`${preparedSlots}/${schedule.length || 0} drafts prepared for Awo`} complete={preparedSlots === schedule.length && schedule.length > 0} />
            <StatusStep title="2. Optimise" detail={`${optimisedCount}/${schedule.length || 0} generated by Awo`} complete={optimisedCount === schedule.length && schedule.length > 0} />
            <StatusStep title="3. Approve & publish" detail={`${approved}/${schedule.length || 0} approved`} complete={approved === schedule.length && schedule.length > 0} />
          </div>
        </div>

        {nextSlot ? <CampaignPublicationLiveCard
          weekNumber={nextSlot.weekNumber}
          scheduledDate={nextSlot.scheduledDate}
          scheduledTime={nextSlot.scheduledTime}
          timezone={nextSlot.timezone}
          optimisedCount={nextOptimisedCount}
          approvedCount={nextApprovedCount}
          slots={nextSlots.map((slot, index) => ({ platformLabel: CAMPAIGN_PLATFORM_LABELS[slot.platform], status: slot.status, draftStatus: nextDrafts[index]?.status ?? null }))}
          onOptimise={<CampaignAwoActions organisationId={orgId} campaignId={campaignId} totalSlots={schedule.length} optimisedCount={optimisedCount} canWrite={canWrite} />}
        /> : <div className="bg-muted/20 p-6"><p className="text-sm text-muted-foreground">No pending publication event.</p></div>}
      </div>
    </section>

    {weekOne.length ? <section className="rounded-xl border border-primary/30 bg-primary/5 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Today · Week 1</p><h3 className="mt-1 text-lg font-semibold">Publishing at {weekOne[0]?.scheduledTime.slice(0,5)} · {weekOne[0]?.timezone}</h3><p className="mt-1 text-sm text-muted-foreground">{weekOne.map(s => CAMPAIGN_PLATFORM_LABELS[s.platform]).join(" + ")} · {optimisedCount ? "Awo optimisation in progress / ready for review" : "Prepared for Awo"}</p></div><Badge tone={optimisedCount >= weekOne.length ? "positive" : "muted"}>{optimisedCount >= weekOne.length ? "Optimised" : "Awo prepared"}</Badge></div></section> : null}

    <CampaignReviewGrid organisationId={orgId} weeks={reviewWeeks} />

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)]">
      <div className="flex flex-col gap-6">
        <Card><CardHeader><CardTitle>Campaign operating brief</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Detail label="Objective" value={campaign.objective}/><Detail label="Target audience" value={campaign.targetAudience}/><Detail label="Primary CTA" value={campaign.primaryCTA}/><Detail label="Success metric" value={campaign.successMetric}/></CardContent></Card>
        <CampaignAssetsPanel organisationId={orgId} campaignId={campaignId} allAssets={allAssets} attachedAssets={attachedAssets} signedUrls={signedUrls} canWrite={canWrite}/>
        <CampaignBulkScheduler organisationId={orgId} campaignId={campaignId} campaignPlatforms={campaign.platforms} campaignStartDate={campaign.startDate} attachedAssets={attachedAssets} signedUrls={signedUrls} canWrite={canWrite}/>
      </div>
      <div className="flex flex-col gap-4">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-primary"/>Live schedule</CardTitle></CardHeader><CardContent className="flex flex-col gap-3">{schedule.slice(0,6).map(slot => { const draft = campaignDrafts.find(d => d?.id === slot.draftId); const generated = Boolean(draft?.body.trim() && draft?.hashtags.length); return <div key={slot.id} className="rounded-md border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium">Week {slot.weekNumber} · {CAMPAIGN_PLATFORM_LABELS[slot.platform]}</span><Badge tone={generated ? "positive" : "muted"}>{generated ? "Optimised" : slot.draftId ? "Prepared" : slot.status}</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">{slot.scheduledDate} · {slot.scheduledTime.slice(0,5)}</p></div>; })}</CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary"/>Intelligence pipeline</CardTitle></CardHeader><CardContent className="space-y-3 text-[12px]"><Pipeline label="MemBrain" value={`${membrainOverview.readiness.percentage}% ready`} complete={membrainOverview.readiness.percentage === 100}/><Pipeline label="Market Intelligence" value="Included in Awo campaign requests" complete/><Pipeline label="Awo execution" value={`${optimisedCount}/${schedule.length || 0} generated`} complete={optimisedCount === schedule.length && schedule.length > 0}/><Pipeline label="Distribution Gate" value="Required before approval"/><Button asChild variant="secondary" size="sm"><Link href={routes.organisations.membrain.index(orgId)}>Open intelligence <ChevronRight className="size-3.5"/></Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="size-4 text-primary"/>Growth loop</CardTitle></CardHeader><CardContent><p className="text-[12px] text-muted-foreground">Published campaign performance feeds Growth so later content can improve from reach, engagement, enquiries and bookings.</p></CardContent></Card>
      </div>
    </div>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-lg border border-border bg-background/70 p-3"><p className="text-[10px] uppercase tracking-wider text-subtle-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p><p className="text-[10px] text-muted-foreground">{detail}</p></div>; }
function StatusStep({ title, detail, complete }: { title: string; detail: string; complete: boolean }) { return <div className="rounded-lg border border-border bg-background/60 p-4"><div className="flex items-center gap-2">{complete ? <CheckCircle2 className="size-4 text-emerald-500"/> : <span className="size-4 rounded-full border border-border"/>}<p className="text-xs font-semibold">{title}</p></div><p className="mt-2 text-[11px] text-muted-foreground">{detail}</p></div>; }
function Pipeline({ label, value, complete = false }: { label: string; value: string; complete?: boolean }) { return <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3"><div><p className="font-medium">{label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{value}</p></div>{complete ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-500"/> : <Sparkles className="mt-0.5 size-4 text-primary"/>}</div>; }
function Detail({label,value}:{label:string;value:string|null}){return <div><p className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</p><p className={`mt-1 text-[13px] ${value?"":"text-subtle-foreground"}`}>{value??"Not set"}</p></div>}
