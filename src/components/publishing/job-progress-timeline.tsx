import { PUBLISHING_PLATFORM_LABELS, type PublishingAttempt, type PublishingJob } from "@/core/domain/entities/publishing";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ProgressStep {
  label: string;
  at: string | null;
  detail?: string | null;
}

function latestAttempt(attempts: PublishingAttempt[]): PublishingAttempt | null {
  return attempts.reduce<PublishingAttempt | null>(
    (latest, attempt) => (!latest || attempt.attemptNumber > latest.attemptNumber ? attempt : latest),
    null,
  );
}

/**
 * The job-level "what happened, in order" view — distinct from AttemptTimeline,
 * which lists every historical attempt. This tracks only the current/latest
 * attempt's four milestones, per mission section 6.B and 7's exact example
 * format ("17:12:03 — Queued", "17:12:05 — Claimed by worker", ...).
 */
export function JobProgressTimeline({ job, attempts }: { job: PublishingJob; attempts: PublishingAttempt[] }) {
  const latest = latestAttempt(attempts);

  const completedOrFailedAt =
    job.status === "published" ? job.completedAt
    : job.status === "failed" ? (latest?.failedAt ?? null)
    : null;

  const steps: ProgressStep[] = [
    { label: "Queued", at: job.createdAt },
    {
      label: "Claimed by worker",
      at: latest?.queuedAt ?? null,
      detail: job.claimedBy ? `Worker: ${job.claimedBy}` : null,
    },
    { label: `Publishing to ${PUBLISHING_PLATFORM_LABELS[job.platform]}`, at: latest?.startedAt ?? null },
    {
      label: job.status === "failed" ? "Failed" : job.status === "published" ? "Marked Published" : "Completed",
      at: completedOrFailedAt,
      detail: job.status === "failed" && latest?.errorMessage ? `Error: ${latest.errorMessage}` : null,
    },
  ];

  let previousAt: string | null = null;

  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, index) => {
        const reached = step.at !== null;
        const elapsedMs = reached && previousAt ? new Date(step.at as string).getTime() - new Date(previousAt).getTime() : null;
        if (reached) previousAt = step.at;

        return (
          <li key={step.label} className="flex items-start gap-3 text-[13px]">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1 size-2 shrink-0 rounded-full",
                reached ? "bg-primary" : "border border-border-strong bg-transparent",
              )}
            />
            <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className={reached ? "text-foreground" : "text-muted-foreground"}>
                {reached ? formatDateTime(step.at) : "Pending"} — {step.label}
                {step.detail ? <span className="ml-1 text-muted-foreground">({step.detail})</span> : null}
              </span>
              {index > 0 && elapsedMs !== null ? (
                <span className="text-[11px] text-muted-foreground">+{formatDuration(elapsedMs)}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
