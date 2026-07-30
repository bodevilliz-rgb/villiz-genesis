import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/core/domain/entities/campaign";
import { CONTENT_DRAFT_STATUS_LABELS } from "@/core/domain/entities/content";
import type { MyWork } from "@/core/domain/entities/dashboard";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

const STATUS_TONE: Record<string, "muted" | "warning" | "positive"> = {
  draft: "muted",
  needs_review: "warning",
  approved: "positive",
};

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[11px] uppercase tracking-wider text-subtle-foreground">{title}</h3>
      {children.length > 0 ? (
        <ul className="flex flex-col gap-1">{children}</ul>
      ) : (
        <p className="text-[12px] text-subtle-foreground">{empty}</p>
      )}
    </div>
  );
}

export function MyWorkPanel({ myWork }: { myWork: MyWork }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My work</CardTitle>
        <CardDescription>What&rsquo;s assigned to you, across every account.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Section title="Reviews waiting on you" empty="Nothing waiting on your review.">
          {myWork.reviewsWaiting.map((review) => (
            <li key={review.draftId}>
              <Link
                href={routes.organisations.content.draft(review.organisationId, review.draftId)}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-card-hover"
              >
                <span className="min-w-0 flex-1 truncate">{review.title}</span>
                <span className="shrink-0 text-[11px] text-subtle-foreground">{review.organisationName}</span>
              </Link>
            </li>
          ))}
        </Section>

        <Section title="Your recent drafts" empty="No drafts of yours yet.">
          {myWork.recentDrafts.map((draft) => (
            <li key={draft.draftId}>
              <Link
                href={routes.organisations.content.draft(draft.organisationId, draft.draftId)}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-card-hover"
              >
                <span className="min-w-0 flex-1 truncate">{draft.title}</span>
                <Badge tone={STATUS_TONE[draft.status] ?? "muted"}>{CONTENT_DRAFT_STATUS_LABELS[draft.status]}</Badge>
              </Link>
            </li>
          ))}
        </Section>

        <Section title="Assigned campaigns" empty="No campaigns yet.">
          {myWork.assignedCampaigns.map((campaign) => (
            <li key={campaign.campaignId}>
              <Link
                href={routes.organisations.campaigns.detail(campaign.organisationId, campaign.campaignId)}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-card-hover"
              >
                <span className="min-w-0 flex-1 truncate">{campaign.name}</span>
                <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
              </Link>
            </li>
          ))}
        </Section>

        <Section title="Your recent activity" empty="No recent activity yet.">
          {myWork.recentActivity.map((item) => (
            <li key={item.id} className="px-2 py-1 text-[12px] text-muted-foreground">
              You {item.action} {item.kind === "membrain" ? "knowledge entry" : item.kind} &quot;{item.entityTitle}
              &quot; in{" "}
              {item.organisationName} · {formatRelative(item.occurredAt)}
            </li>
          ))}
        </Section>
      </CardContent>
    </Card>
  );
}
