import { Badge } from "@/components/ui/badge";
import { PUBLISHING_ATTEMPT_STATUS_LABELS, type PublishingAttempt } from "@/core/domain/entities/publishing";
import { formatDateTime, formatDuration } from "@/lib/format";
import { FailureClassificationBadge } from "./failure-classification";

const STATUS_TONE: Record<PublishingAttempt["status"], "muted" | "accent" | "positive" | "danger" | "warning"> = {
  queued: "muted",
  started: "accent",
  // Non-terminal and not a failure — the submission reached the provider and
  // is simply unconfirmed (see PublishingAttemptStatus).
  awaiting_confirmation: "warning",
  completed: "positive",
  failed: "danger",
};

/** One row per immutable attempt row, oldest first — the exact append-only history no update can ever rewrite. */
export function AttemptTimeline({ attempts }: { attempts: PublishingAttempt[] }) {
  const ordered = [...attempts].sort((a, b) => a.attemptNumber - b.attemptNumber);

  return (
    <ol className="flex flex-col gap-3">
      {ordered.map((attempt) => (
        <li key={attempt.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Attempt {attempt.attemptNumber}</span>
            <Badge tone={STATUS_TONE[attempt.status]}>{PUBLISHING_ATTEMPT_STATUS_LABELS[attempt.status]}</Badge>
            {attempt.retryOfAttemptId ? <Badge tone="muted">Retry of attempt {attempt.attemptNumber - 1}</Badge> : null}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted-foreground sm:grid-cols-4">
            <span>Queued: {formatDateTime(attempt.queuedAt)}</span>
            <span>Started: {formatDateTime(attempt.startedAt)}</span>
            <span>{attempt.status === "failed" ? "Failed" : "Completed"}: {formatDateTime(attempt.completedAt ?? attempt.failedAt)}</span>
            <span>Duration: {formatDuration(attempt.durationMs)}</span>
          </div>

          {attempt.status === "completed" && attempt.externalUrl ? (
            <a
              href={attempt.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-block text-[12px] font-medium text-primary hover:underline"
            >
              Open mock post — {attempt.externalPostId}
            </a>
          ) : null}

          {attempt.status === "failed" ? (
            <div className="mt-2">
              <FailureClassificationBadge errorCode={attempt.errorCode} errorMessage={attempt.errorMessage} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
