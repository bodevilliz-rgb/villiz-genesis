import { Badge } from "@/components/ui/badge";
import { PUBLISHING_ATTEMPT_STATUS_LABELS, type PublishingAttempt } from "@/core/domain/entities/publishing";
import { formatDateTime } from "@/lib/format";

const STATUS_TONE: Record<PublishingAttempt["status"], "muted" | "accent" | "positive" | "danger"> = {
  queued: "muted",
  started: "accent",
  completed: "positive",
  failed: "danger",
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

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
            <p className="mt-2 rounded bg-danger-soft p-2 text-[12px] text-danger">
              {attempt.errorCode}: {attempt.errorMessage}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
