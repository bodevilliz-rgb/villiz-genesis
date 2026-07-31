import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CONTENT_DRAFT_STATUS_LABELS, CONTENT_DRAFT_TYPE_LABELS, type ContentDraft } from "@/core/domain/entities/content";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

const STATUS_TONE: Record<ContentDraft["status"], "muted" | "warning" | "positive" | "danger"> = {
  draft: "muted",
  needs_review: "warning",
  in_review: "warning",
  changes_requested: "warning",
  approved: "positive",
  rejected: "danger",
  scheduled: "positive",
  published: "positive",
  archived: "muted",
};

export function DraftCard({ organisationId, draft }: { organisationId: string; draft: ContentDraft }) {
  return (
    <Link
      href={routes.organisations.content.draft(organisationId, draft.id)}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:bg-card-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{draft.title}</span>
        <Badge tone={STATUS_TONE[draft.status]}>{CONTENT_DRAFT_STATUS_LABELS[draft.status]}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="muted">{CONTENT_DRAFT_TYPE_LABELS[draft.contentType]}</Badge>
        {draft.category ? <Badge tone="muted">{draft.category.label}</Badge> : null}
        {draft.campaign ? <Badge tone="accent">{draft.campaign.name}</Badge> : null}
        {draft.awoStatus === "ready_for_awo" ? <Badge tone="accent">Ready for Awo</Badge> : null}
      </div>

      <p className="text-[12px] text-subtle-foreground">
        {draft.updatedBy?.fullName ?? draft.updatedBy?.email ?? "Unknown"} · Updated {formatRelative(draft.updatedAt)}
      </p>
    </Link>
  );
}
