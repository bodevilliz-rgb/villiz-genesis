import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CONTENT_DRAFT_STATUS_LABELS, CONTENT_DRAFT_TYPE_LABELS, type ContentDraft } from "@/core/domain/entities/content";
import { PlatformBadge } from "@/components/publishing/platform-badge";
import type { PublishingJob } from "@/core/domain/entities/publishing";
import { formatDateTime, formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

/** Bundled here rather than re-fetched inside DraftCard — this is a presentational component, the caller already has the job/attempt data from its own publishing-queue fetch. */
export interface DraftPublishingSummary {
  job: PublishingJob;
  latestErrorMessage: string | null;
  mockUrl: string | null;
}

export const CONTENT_DRAFT_STATUS_TONE: Record<ContentDraft["status"], "muted" | "warning" | "positive" | "danger"> = {
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

export function DraftCard({
  organisationId,
  draft,
  publishing,
}: {
  organisationId: string;
  draft: ContentDraft;
  /** Only meaningful for scheduled/publishing/failed/published drafts — pass when the caller already has the job data (e.g. the Publishing Queue tab), omit elsewhere. */
  publishing?: DraftPublishingSummary | null;
}) {
  // A failed draft's card links straight to the job's own detail/error page
  // instead of the draft editor — that's where the actionable retry lives.
  const href =
    draft.status === "failed" && publishing?.job
      ? routes.organisations.publishing.job(organisationId, publishing.job.id)
      : routes.organisations.content.draft(organisationId, draft.id);

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:bg-card-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{draft.title}</span>
        <Badge tone={CONTENT_DRAFT_STATUS_TONE[draft.status]}>{CONTENT_DRAFT_STATUS_LABELS[draft.status]}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="muted">{CONTENT_DRAFT_TYPE_LABELS[draft.contentType]}</Badge>
        {draft.category ? <Badge tone="muted">{draft.category.label}</Badge> : null}
        {draft.campaign ? <Badge tone="accent">{draft.campaign.name}</Badge> : null}
        {draft.awoStatus === "ready_for_awo" ? <Badge tone="accent">Ready for Awo</Badge> : null}
        {publishing?.job ? <PlatformBadge platform={publishing.job.platform} size="sm" /> : null}
      </div>

      {publishing?.job ? (
        <div className="flex flex-col gap-1 text-[12px]">
          {draft.status === "scheduled" ? (
            <span className="text-muted-foreground">Scheduled for {formatDateTime(publishing.job.scheduledFor)}</span>
          ) : null}
          {draft.status === "failed" && publishing.latestErrorMessage ? (
            <span className="text-danger">Failed — {publishing.latestErrorMessage}</span>
          ) : null}
          {draft.status === "published" && publishing.mockUrl ? (
            <span className="truncate text-primary">Published — {publishing.mockUrl}</span>
          ) : null}
        </div>
      ) : null}

      <p className="text-[12px] text-subtle-foreground">
        {draft.updatedBy?.fullName ?? draft.updatedBy?.email ?? "Unknown"} · Updated {formatRelative(draft.updatedAt)}
      </p>
    </Link>
  );
}
