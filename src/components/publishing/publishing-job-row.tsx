"use client";
import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { PlatformBadge } from "@/components/publishing/platform-badge";
import { RequesterName } from "@/components/publishing/requester-name";
import { cancelPublishingJobAction, retryPublishingJobAction } from "@/server/actions/publishing";
import { idleState } from "@/server/action-result";
import {
  PUBLISHING_JOB_STATUS_LABELS,
  PUBLISHING_PLATFORM_LABELS,
  PUBLISHING_TRIGGER_TYPE_LABELS,
  type PublishingAttempt,
  type PublishingJob,
} from "@/core/domain/entities/publishing";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

const STATUS_TONE: Record<PublishingJob["status"], "muted" | "warning" | "positive" | "danger" | "accent"> = {
  queued: "muted",
  processing: "accent",
  published: "positive",
  failed: "danger",
  cancelled: "muted",
};

function latestAttempt(attempts: PublishingAttempt[]): PublishingAttempt | null {
  return attempts.reduce<PublishingAttempt | null>(
    (latest, attempt) => (!latest || attempt.attemptNumber > latest.attemptNumber ? attempt : latest),
    null,
  );
}

export function PublishingJobRow({
  organisationId,
  job,
  draftTitle,
  campaign,
  organisationName,
  scheduledTimezone,
  attempts,
  canWrite,
}: {
  organisationId: string;
  job: PublishingJob;
  draftTitle: string;
  /** From the draft's own `campaign` field — a job never carries its own campaign reference. */
  campaign: { id: string; name: string } | null;
  organisationName: string;
  /** From the draft's own `scheduledTimezone` field — shown alongside the countdown for a not-yet-due scheduled job. */
  scheduledTimezone?: string | null;
  /** The job's full immutable attempt history, oldest first or unordered — used only to derive started/completed/duration/error/mock-url, never to infer status. */
  attempts: PublishingAttempt[];
  canWrite: boolean;
}) {
  const [retryState, retryAction] = useActionState(retryPublishingJobAction, idleState);
  const [cancelState, cancelAction] = useActionState(cancelPublishingJobAction, idleState);

  useEffect(() => {
    if (retryState.status === "success") toast.success(retryState.message);
    if (retryState.status === "error") toast.error(retryState.message);
  }, [retryState]);

  useEffect(() => {
    if (cancelState.status === "success") toast.success(cancelState.message);
    if (cancelState.status === "error") toast.error(cancelState.message);
  }, [cancelState]);

  const isScheduledNotYetDue = job.triggerType === "scheduled" && job.status === "queued" && new Date(job.scheduledFor) > new Date();
  const latest = latestAttempt(attempts);
  const startedAt = latest?.startedAt ?? null;

  const terminalAt =
    job.status === "published" ? job.completedAt
    : job.status === "failed" ? (latest?.failedAt ?? null)
    : job.status === "cancelled" ? job.cancelledAt
    : null;

  const totalDurationMs = terminalAt
    ? new Date(terminalAt).getTime() - new Date(job.createdAt).getTime()
    : null;

  const latestFailure = job.status === "failed" && latest?.status === "failed" ? latest : null;
  const mockUrl = job.status === "published" ? (latest?.externalUrl ?? null) : null;

  const canRetry = job.status === "failed" && job.retryCount < job.maxRetries;
  const canCancel = job.status === "queued";
  const canOpenMockPost = job.status === "published" && !!mockUrl;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={routes.organisations.publishing.job(organisationId, job.id)}
            className="font-medium hover:underline"
          >
            <span className="sr-only">Content title: </span>
            {draftTitle}
          </Link>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <span>{organisationName}</span>
            {campaign ? (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  href={routes.organisations.campaigns.detail(organisationId, campaign.id)}
                  className="hover:text-foreground hover:underline"
                >
                  {campaign.name}
                </Link>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[job.status]}>
            {isScheduledNotYetDue ? "Scheduled" : PUBLISHING_JOB_STATUS_LABELS[job.status]}
          </Badge>
          <PlatformBadge platform={job.platform} />
          <Badge tone="muted">{PUBLISHING_TRIGGER_TYPE_LABELS[job.triggerType]}</Badge>
          {job.retryCount > 0 ? (
            <Badge tone="warning">
              Retry {job.retryCount}/{job.maxRetries}
            </Badge>
          ) : null}
        </div>
      </div>

      {job.status === "processing" ? (
        <p className="flex items-center gap-2 text-[12px] text-foreground" role="status" aria-live="polite">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-primary" />
          Publishing to {PUBLISHING_PLATFORM_LABELS[job.platform]} — attempt {latest?.attemptNumber ?? (attempts.length || 1)}, started {formatDateTime(startedAt)}
        </p>
      ) : null}

      {job.status === "queued" && !isScheduledNotYetDue ? (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-muted-foreground" />
          Waiting for the worker to pick this up
        </p>
      ) : null}

      {isScheduledNotYetDue ? (
        <p className="text-[12px] text-muted-foreground">
          Scheduled for {formatDateTime(job.scheduledFor)}
          {scheduledTimezone ? ` (${scheduledTimezone})` : ""} — {formatRelative(job.scheduledFor)}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted-foreground sm:grid-cols-4">
        <span>Queued: {formatDateTime(job.createdAt)}</span>
        <span>{job.triggerType === "scheduled" ? "Scheduled for" : "Due"}: {formatDateTime(job.scheduledFor)}</span>
        <span>Started: {formatDateTime(startedAt)}</span>
        <span>{job.status === "failed" ? "Failed" : "Completed"}: {formatDateTime(terminalAt)}</span>
        <span>Duration: {formatDuration(totalDurationMs)}</span>
        <span>Attempts: {attempts.length}</span>
        <span>
          Requested by: <RequesterName profile={job.requestedByProfile} />
        </span>
      </div>

      {latestFailure ? (
        <p className="rounded bg-danger-soft p-2 text-[12px] text-danger" role="status">
          Latest error — {latestFailure.errorCode}: {latestFailure.errorMessage}
        </p>
      ) : null}

      {canWrite && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={routes.organisations.publishing.job(organisationId, job.id)}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            View Job
          </Link>
          <Link
            href={routes.organisations.content.draft(organisationId, job.draftId)}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            Open Draft
          </Link>
          {campaign ? (
            <Link
              href={routes.organisations.campaigns.detail(organisationId, campaign.id)}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              Open Campaign
            </Link>
          ) : null}
          {canOpenMockPost ? (
            <a
              href={mockUrl ?? undefined}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[12px] font-medium text-primary hover:underline"
            >
              Open Mock Post
            </a>
          ) : null}

          {canRetry && (
            <form action={retryAction}>
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="draftId" value={job.draftId} />
              <SubmitButton variant="secondary" pendingLabel="Retrying…">
                Retry Publish
              </SubmitButton>
            </form>
          )}

          {canCancel && (
            <form action={cancelAction}>
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="draftId" value={job.draftId} />
              <SubmitButton variant="ghost" className="text-danger hover:bg-danger/5" pendingLabel="Cancelling…">
                Cancel Job
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
