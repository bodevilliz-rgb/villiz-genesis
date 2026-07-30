import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { Megaphone } from "lucide-react";
import { CAMPAIGN_PLATFORM_LABELS } from "@/core/domain/entities/campaign";
import type { CampaignHealth } from "@/core/domain/entities/dashboard";
import { formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";

function CampaignHealthCard({ campaign }: { campaign: CampaignHealth }) {
  const remainingDays =
    campaign.timeline.totalDays !== null && campaign.timeline.elapsedDays !== null
      ? Math.max(campaign.timeline.totalDays - campaign.timeline.elapsedDays, 0)
      : null;

  return (
    <Link
      href={routes.organisations.campaigns.detail(campaign.organisationId, campaign.campaignId)}
      className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:bg-card-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{campaign.name}</span>
        <span className="shrink-0 text-[11px] text-subtle-foreground">{campaign.organisationName}</span>
      </div>

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
        <span>
          {formatNumber(campaign.draftCount)} {campaign.draftCount === 1 ? "draft" : "drafts"}
        </span>
        <span>·</span>
        <span>{remainingDays !== null ? `${remainingDays} days remaining` : "No dates set"}</span>
        <span>·</span>
        <span>{campaign.readiness ? `${campaign.readiness.score}% ready` : "Readiness unavailable"}</span>
      </div>

      {campaign.readiness && campaign.readiness.warnings.length > 0 ? (
        <p className="line-clamp-1 text-[12px] text-warning">{campaign.readiness.warnings[0]}</p>
      ) : null}
    </Link>
  );
}

export function ActiveCampaignsPanel({ campaigns }: { campaigns: CampaignHealth[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active campaigns</CardTitle>
        <CardDescription>Readiness and remaining time, across every account.</CardDescription>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? (
          <EmptyState
            icon={<Megaphone aria-hidden />}
            title="No active campaigns"
            description="Campaigns you set to Active will show their health here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {campaigns.map((campaign) => (
              <CampaignHealthCard key={campaign.campaignId} campaign={campaign} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
