import { Badge } from "@/components/ui/badge";
import { CONTENT_DRAFT_STATUS_LABELS } from "@/core/domain/entities/content";
import { REVIEW_ACTION_LABELS, type ReviewHistoryEntry } from "@/core/domain/entities/review";
import { formatDateTime } from "@/lib/format";

/**
 * A separate timeline from DraftVersionTimeline — this one answers "who
 * decided what, when, and why", not "what did the content look like". See
 * the review-workflow migration's own note on why the two are not merged.
 */
export function ReviewHistoryTimeline({ history }: { history: ReviewHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No review activity yet.</p>;
  }

  return (
    <ol className="flex flex-col">
      {history.map((entry, index) => {
        const isLast = index === history.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast ? <span aria-hidden className="absolute left-[7px] top-4 h-full w-px bg-border" /> : null}
            <span
              aria-hidden
              className="relative mt-1.5 size-[15px] shrink-0 rounded-full border-2 border-border-strong bg-background"
            />

            <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="muted">{REVIEW_ACTION_LABELS[entry.action]}</Badge>
                <span className="ml-auto text-[11px] text-subtle-foreground">{formatDateTime(entry.createdAt)}</span>
              </div>

              <p className="text-[13px]">
                <span className="font-medium">{entry.actor?.fullName ?? entry.actor?.email ?? "Unknown"}</span>{" "}
                {entry.previousStatus !== entry.newStatus ? (
                  <>
                    moved this draft from{" "}
                    <span className="font-medium">{CONTENT_DRAFT_STATUS_LABELS[entry.previousStatus]}</span> to{" "}
                    <span className="font-medium">{CONTENT_DRAFT_STATUS_LABELS[entry.newStatus]}</span>
                  </>
                ) : entry.assignedReviewer ? (
                  <>
                    assigned{" "}
                    <span className="font-medium">
                      {entry.assignedReviewer.fullName ?? entry.assignedReviewer.email}
                    </span>{" "}
                    to review
                  </>
                ) : (
                  "updated this draft"
                )}
              </p>

              {entry.comment ? <p className="text-[12px] text-muted-foreground">{entry.comment}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
