import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireContext } from "@/server/container";
import { isReviewQueueTabAvailable, listEligibleReviewers, listReviewQueue } from "@/core/application/use-cases/review";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ReviewQueueFilters } from "@/components/content/review-queue-filters";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CONTENT_DRAFT_STATUS_LABELS,
  CONTENT_DRAFT_TYPE_LABELS,
  type ContentDraftStatus,
} from "@/core/domain/entities/content";
import { REVIEW_QUEUE_TAB_LABELS, type ReviewQueueTab } from "@/core/domain/entities/review";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Review queue" };

const TABS: ReviewQueueTab[] = [
  "awaiting_assignment",
  "assigned_to_me",
  "all_pending",
  "returned_for_changes",
  "recently_approved",
];

const STATUS_TONE: Record<ContentDraftStatus, "muted" | "warning" | "positive" | "danger"> = {
  draft: "muted",
  needs_review: "warning",
  in_review: "warning",
  changes_requested: "warning",
  awaiting_client: "warning",
  approved: "positive",
  rejected: "danger",
  scheduled: "positive",
  publishing: "positive",
  published: "positive",
  failed: "danger",
  archived: "muted",
};

function tabHref(tab: ReviewQueueTab, searchParams: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  for (const key of ["organisationId", "campaignId", "authorId", "reviewerId", "from", "to"]) {
    const value = searchParams[key];
    if (value) params.set(key, value);
  }
  return `${routes.review}?${params.toString()}`;
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    organisationId?: string;
    campaignId?: string;
    authorId?: string;
    reviewerId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const context = await requireContext();

  const deps = {
    actor: context.actor,
    content: context.content,
    reviews: context.reviews,
    organisations: context.organisations,
  };

  const organisations = await context.organisations.listForActor();
  const viewerRoles = new Map(organisations.map((o) => [o.id, o.viewerRole]));

  const availableTabs = TABS.filter((tab) => isReviewQueueTabAvailable(tab, context.actor, viewerRoles));
  const requestedTab = TABS.find((tab) => tab === params.tab);
  const activeTab: ReviewQueueTab =
    requestedTab && availableTabs.includes(requestedTab) ? requestedTab : (availableTabs[0] ?? "returned_for_changes");

  const organisationId = params.organisationId || undefined;

  const [campaigns, members, eligibleReviewers, items] = await Promise.all([
    organisationId
      ? context.campaigns.listCampaigns({ organisationId, limit: 200, offset: 0 })
      : Promise.resolve([]),
    organisationId ? context.organisations.listMembers(organisationId) : Promise.resolve([]),
    organisationId && activeTab === "all_pending" ? listEligibleReviewers(deps, organisationId) : Promise.resolve([]),
    listReviewQueue(deps, activeTab, {
      organisationId,
      campaignId: params.campaignId || undefined,
      authorId: params.authorId || undefined,
      assignedReviewerId: params.reviewerId || undefined,
      submittedFrom: params.from || undefined,
      submittedTo: params.to || undefined,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Project Genesis"
        title="Review queue"
        description="Every draft in the review workflow, across the accounts you can see."
      />

      <nav aria-label="Review queue views" className="flex flex-wrap gap-1 border-b border-border">
        {availableTabs.map((tab) => (
          <Link
            key={tab}
            href={tabHref(tab, params)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              tab === activeTab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {REVIEW_QUEUE_TAB_LABELS[tab]}
          </Link>
        ))}
      </nav>

      <ReviewQueueFilters
        tab={activeTab}
        organisations={organisations}
        campaigns={campaigns}
        members={members}
        reviewers={eligibleReviewers}
        showReviewerFilter={activeTab === "all_pending"}
        defaults={{
          organisationId: params.organisationId,
          campaignId: params.campaignId,
          authorId: params.authorId,
          reviewerId: params.reviewerId,
          from: params.from,
          to: params.to,
        }}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 aria-hidden />}
          title="Nothing here"
          description="Nothing matches this view right now — try a different tab or clear the filters."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.draftId}>
                  <Link
                    href={routes.reviewWorkspace(item.draftId)}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-card-hover group"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium group-hover:text-primary transition-colors">{item.title}</span>
                      <span className="block truncate text-[12px] text-subtle-foreground">
                        {item.organisationName}
                        {item.campaignName ? ` · ${item.campaignName}` : ""} ·{" "}
                        {item.updatedBy?.fullName ?? item.updatedBy?.email ?? "Unknown"} · Updated{" "}
                        {formatRelative(item.updatedAt)}
                      </span>
                    </span>
                    {item.assignedReviewer ? (
                      <span className="hidden text-[11px] text-subtle-foreground sm:inline">
                        {item.assignedReviewer.fullName ?? item.assignedReviewer.email}
                      </span>
                    ) : null}
                    <Badge tone="muted">{CONTENT_DRAFT_TYPE_LABELS[item.contentType]}</Badge>
                    <Badge tone={STATUS_TONE[item.status]}>{CONTENT_DRAFT_STATUS_LABELS[item.status]}</Badge>
                    <span className="ml-2 rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground shadow-sm transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      Open Review
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
