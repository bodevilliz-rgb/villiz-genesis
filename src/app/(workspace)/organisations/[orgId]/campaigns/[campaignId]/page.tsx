import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2, ChevronRight, Pencil, Sparkles, TrendingUp, WandSparkles } from "lucide-react";
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
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import { CAMPAIGN_PLATFORM_LABELS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/core/domain/entities/campaign";
import { CampaignAssetsPanel } from "@/components/campaigns/campaign-assets-panel";
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
  const readySlots = schedule.filter(s => s.draftId).length;
  const approved = draftCounts.approved;
  const nextSlot = schedule[0] ?? null;
  const weekOne = schedule.filter(s => s.weekNumber === 1);
  const weekGroups = Array.from(new Set(schedule.map(s => s.weekNumber))).map(weekNumber => ({
    weekNumber,
    slots: schedule.filter(s => s.weekNumber === weekNumber),
    asset: attachedAssets[weekNumber - 1] ?? null,
  }));

  return <div className="flex flex-col gap-6">
    <PageHeader
      eyebrow="Campaign command centre"
      title={campaign.name}
      description={campaign.objective ?? "Plan, optimise, approve and publish this campaign from one workspace."}
      actions={<div className="flex flex-wrap items-center gap-2">
        <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
        {canWrite ? <Button asChild variant="secondary" size="sm"><Link href={routes.organisations.campaigns.edit(orgId, campaignId)}><Pencil aria-hidden />Edit</Link></Button> : null}
        {canArchive && campaign.status !== "archived" ? <CampaignArchiveButton organisationId={orgId} campaignId={campaignId} name={campaign.name} /> : null}
      </div>}
    />

    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,.55fr)]">
        <div className="border-b border-border p-6 xl:border-b-0 xl:border-r">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="positive">Live campaign</Badge>
                {campaign.platforms.map(p => <Badge key={p} tone="muted">{CAMPAIGN_PLATFORM_LABELS[p]}</Badge>)}
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">{weeks || attachedAssets.length} weeks · {schedule.length || attachedAssets.length * Math.max(campaign.platforms.length, 1)} platform posts</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Upload once, let Awo prepare platform-specific content, review exceptions, approve and publish from one campaign workspace.</p>
            </div>
            <div className="grid min-w-[260px] grid-cols-2 gap-2">
              <Metric label="Assets" value={String(attachedAssets.length)} detail="linked" />
              <Metric label="Slots" value={String(schedule.length)} detail="scheduled" />
              <Metric label="Awo ready" value={`${readySlots}/${schedule.length || 0}`} detail="drafts" />
              <Metric label="Approved" value={String(approved)} detail="posts" />
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <StatusStep title="1. Prepare" detail={`${attachedAssets.length} campaign assets linked`} complete={attachedAssets.length > 0} />
            <StatusStep title="2. Optimise" detail={`${readySlots} drafts prepared for Awo`} complete={readySlots === schedule.length && schedule.length > 0} />
            <StatusStep title="3. Approve & publish" detail={`${approved} approved`} complete={approved === schedule.length && schedule.length > 0} />
          </div>
        </div>

        <div className="bg-muted/20 p-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-subtle-foreground">Next publication</p>
          {nextSlot ? <>
            <p className="mt-3 text-xl font-semibold">Week {nextSlot.weekNumber} · {CAMPAIGN_PLATFORM_LABELS[nextSlot.platform]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{nextSlot.scheduledDate} · {nextSlot.scheduledTime.slice(0,5)} · {nextSlot.timezone}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" disabled><WandSparkles aria-hidden />Awo optimise all</Button>
              <Button size="sm" variant="secondary" disabled>Approve all</Button>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">Bulk optimisation becomes active when the Awo execution layer is connected. The campaign schedule and intelligence context are already ready.</p>
          </> : <p className="mt-3 text-sm text-muted-foreground">Build the campaign schedule to activate publishing.</p>}
        </div>
      </div>
    </section>

    {weekOne.length ? <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Today · Week 1</p>
          <h3 className="mt-1 text-lg font-semibold">Publishing at {weekOne[0]?.scheduledTime.slice(0,5)} · {weekOne[0]?.timezone}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{weekOne.map(s => CAMPAIGN_PLATFORM_LABELS[s.platform]).join(" + ")} · {weekOne.every(s => s.draftId) ? "Awo preparation ready" : "Preparation in progress"}</p>
        </div>
        <Badge tone={weekOne.every(s => s.draftId) ? "positive" : "muted"}>{weekOne.every(s => s.draftId) ? "Awo ready" : "Preparing"}</Badge>
      </div>
    </section> : null}

    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Campaign visual timeline</h3>
          <p className="mt-1 text-xs text-muted-foreground">See all campaign weeks, artwork and platform readiness at a glance.</p>
        </div>
        <span className="text-xs text-muted-foreground">{weekGroups.length} weeks · {schedule.length} platform slots</span>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
        {weekGroups.map(group => {
          const asset = group.asset;
          const src = asset ? signedUrls[asset.storagePath] : undefined;
          const allReady = group.slots.every(s => s.draftId);
          return <div key={group.weekNumber} className="overflow-hidden rounded-lg border border-border bg-muted/10">
            <div className="aspect-square bg-muted/30">{src ? <img src={src} alt={`Week ${group.weekNumber}`} className="h-full w-full object-cover" /> : null}</div>
            <div className="p-3">
              <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">Week {group.weekNumber}</p><span className={`size-2 rounded-full ${allReady ? "bg-emerald-500" : "bg-muted-foreground/40"}`} /></div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{asset?.title || asset?.fileName || "No asset"}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">{group.slots.map(s => CAMPAIGN_PLATFORM_LABELS[s.platform]).join(" · ")}</p>
            </div>
          </div>;
        })}
      </div>
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)]">
      <div className="flex flex-col gap-6">
        <Card><CardHeader><CardTitle>Campaign operating brief</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Detail label="Objective" value={campaign.objective}/><Detail label="Target audience" value={campaign.targetAudience}/><Detail label="Primary CTA" value={campaign.primaryCTA}/><Detail label="Success metric" value={campaign.successMetric}/></CardContent></Card>
        <CampaignAssetsPanel organisationId={orgId} campaignId={campaignId} allAssets={allAssets} attachedAssets={attachedAssets} signedUrls={signedUrls} canWrite={canWrite}/>
        <CampaignBulkScheduler organisationId={orgId} campaignId={campaignId} campaignPlatforms={campaign.platforms} campaignStartDate={campaign.startDate} attachedAssets={attachedAssets} signedUrls={signedUrls} canWrite={canWrite}/>
      </div>

      <div className="flex flex-col gap-4">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-primary"/>Live schedule</CardTitle></CardHeader><CardContent className="flex flex-col gap-3">{schedule.slice(0,6).map(slot => <div key={slot.id} className="rounded-md border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium">Week {slot.weekNumber} · {CAMPAIGN_PLATFORM_LABELS[slot.platform]}</span><Badge tone={slot.draftId?"positive":"muted"}>{slot.draftId?"Awo ready":slot.status}</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">{slot.scheduledDate} · {slot.scheduledTime.slice(0,5)}</p></div>)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary"/>Intelligence pipeline</CardTitle></CardHeader><CardContent className="space-y-3 text-[12px]"><Pipeline label="MemBrain" value={`${membrainOverview.readiness.percentage}% ready`} complete={membrainOverview.readiness.percentage === 100}/><Pipeline label="Market Intelligence" value="Connected to Awo requests" complete/><Pipeline label="Distribution Gate" value="Required before publishing"/><Button asChild variant="secondary" size="sm"><Link href={routes.organisations.membrain.index(orgId)}>Open intelligence <ChevronRight className="size-3.5"/></Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="size-4 text-primary"/>Growth loop</CardTitle></CardHeader><CardContent><p className="text-[12px] text-muted-foreground">Published campaign performance feeds Growth so later content can improve from reach, engagement, enquiries and bookings.</p></CardContent></Card>
      </div>
    </div>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-lg border border-border bg-background/70 p-3"><p className="text-[10px] uppercase tracking-wider text-subtle-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p><p className="text-[10px] text-muted-foreground">{detail}</p></div>; }
function StatusStep({ title, detail, complete }: { title: string; detail: string; complete: boolean }) { return <div className="rounded-lg border border-border bg-background/60 p-4"><div className="flex items-center gap-2">{complete ? <CheckCircle2 className="size-4 text-emerald-500"/> : <span className="size-4 rounded-full border border-border"/>}<p className="text-xs font-semibold">{title}</p></div><p className="mt-2 text-[11px] text-muted-foreground">{detail}</p></div>; }
function Pipeline({ label, value, complete = false }: { label: string; value: string; complete?: boolean }) { return <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3"><div><p className="font-medium">{label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{value}</p></div>{complete ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-500"/> : <Sparkles className="mt-0.5 size-4 text-primary"/>}</div>; }
function Detail({label,value}:{label:string;value:string|null}){return <div><p className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</p><p className={`mt-1 text-[13px] ${value?"":"text-subtle-foreground"}`}>{value??"Not set"}</p></div>}
