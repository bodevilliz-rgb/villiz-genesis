import Link from "next/link";
import { ArrowUpRight, CalendarDays, FileText, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CAMPAIGN_PLATFORM_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONE,
  type CampaignListItem,
} from "@/core/domain/entities/campaign";
import { formatDate, formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";

export function CampaignCard({ organisationId, campaign, membrainReadinessPercent }: { organisationId: string; campaign: CampaignListItem; membrainReadinessPercent: number }) {
  const dateRange = campaign.startDate || campaign.endDate
    ? `${campaign.startDate ? formatDate(campaign.startDate) : "No start"} – ${campaign.endDate ? formatDate(campaign.endDate) : "No end"}`
    : "Dates not set";

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:border-primary/30 hover:bg-card-hover">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[16px] font-semibold text-foreground">{campaign.name}</h3>
              <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
            </div>
            {campaign.client || campaign.brand ? <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-subtle-foreground">{campaign.client ?? campaign.brand}</p> : null}
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href={routes.organisations.campaigns.detail(organisationId, campaign.id)}>
              Open <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        {campaign.objective ? <p className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">{campaign.objective}</p> : null}

        <div className="flex flex-wrap gap-1.5">
          {campaign.platforms.map((platform) => <Badge key={platform} tone="muted">{CAMPAIGN_PLATFORM_LABELS[platform]}</Badge>)}
          {campaign.priority ? <Badge tone="muted">{campaign.priority} priority</Badge> : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <MiniMetric icon={<CalendarDays className="size-3.5" />} label="Timeline" value={dateRange} />
          <MiniMetric icon={<FileText className="size-3.5" />} label="Content" value={`${formatNumber(campaign.draftCount)} ${campaign.draftCount === 1 ? "draft" : "drafts"}`} />
          <MiniMetric icon={<Target className="size-3.5" />} label="MemBrain" value={`${membrainReadinessPercent}% ready`} />
        </div>
      </div>

      <div className="border-t border-border bg-black/10 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-subtle-foreground">
          <span>{campaign.campaignType ?? "Campaign"}</span>
          <span>{campaign.successMetric ? `Success: ${campaign.successMetric}` : "Success metric not set"}</span>
        </div>
      </div>
    </article>
  );
}

function MiniMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-muted/20 p-3"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-subtle-foreground">{icon}{label}</div><p className="mt-1 truncate text-[12px] font-medium text-foreground">{value}</p></div>;
}
