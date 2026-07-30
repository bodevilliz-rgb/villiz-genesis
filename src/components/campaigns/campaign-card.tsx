import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  CAMPAIGN_PLATFORM_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONE,
  type CampaignListItem,
} from "@/core/domain/entities/campaign";
import { formatDate, formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";

export function CampaignCard({
  organisationId,
  campaign,
  membrainReadinessPercent,
}: {
  organisationId: string;
  campaign: CampaignListItem;
  membrainReadinessPercent: number;
}) {
  const dateRange =
    campaign.startDate || campaign.endDate
      ? `${campaign.startDate ? formatDate(campaign.startDate) : "No start"} – ${campaign.endDate ? formatDate(campaign.endDate) : "No end"}`
      : "No dates set";

  return (
    <Link
      href={routes.organisations.campaigns.detail(organisationId, campaign.id)}
      className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:bg-card-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{campaign.name}</span>
        <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
      </div>

      {campaign.objective ? (
        <p className="line-clamp-2 text-[12px] text-muted-foreground">{campaign.objective}</p>
      ) : null}

      {campaign.platforms.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {campaign.platforms.map((platform) => (
            <Badge key={platform} tone="muted">
              {CAMPAIGN_PLATFORM_LABELS[platform]}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle-foreground">
        <span>{dateRange}</span>
        <span>·</span>
        <span>
          {formatNumber(campaign.draftCount)} {campaign.draftCount === 1 ? "draft" : "drafts"}
        </span>
        <span>·</span>
        <span>MemBrain {membrainReadinessPercent}% ready</span>
      </div>
    </Link>
  );
}
