"use client";
import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelPublishingJobAction, retryPublishingJobAction } from "@/server/actions/publishing";
import { idleState } from "@/server/action-result";
import {
  PUBLISHING_JOB_STATUS_LABELS,
  PUBLISHING_PLATFORM_LABELS,
  PUBLISHING_TRIGGER_TYPE_LABELS,
  type PublishingJob,
} from "@/core/domain/entities/publishing";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";

const STATUS_TONE: Record<PublishingJob["status"], "muted" | "warning" | "positive" | "danger" | "accent"> = {
  queued: "muted",
  processing: "accent",
  published: "positive",
  failed: "danger",
  cancelled: "muted",
};

export function PublishingJobRow({
  organisationId,
  job,
  draftTitle,
  canWrite,
}: {
  organisationId: string;
  job: PublishingJob;
  draftTitle: string;
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

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={routes.organisations.publishing.job(organisationId, job.id)} className="font-medium hover:underline">
          {draftTitle}
        </Link>
        <Badge tone={STATUS_TONE[job.status]}>
          {isScheduledNotYetDue ? "Scheduled" : PUBLISHING_JOB_STATUS_LABELS[job.status]}
        </Badge>
        <Badge tone="muted">{PUBLISHING_PLATFORM_LABELS[job.platform]}</Badge>
        <Badge tone="muted">{PUBLISHING_TRIGGER_TYPE_LABELS[job.triggerType]}</Badge>
        {job.retryCount > 0 ? <Badge tone="warning">Retry {job.retryCount}/{job.maxRetries}</Badge> : null}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted-foreground sm:grid-cols-4">
        <span>Queued: {formatDateTime(job.createdAt)}</span>
        <span>{job.triggerType === "scheduled" ? "Scheduled for" : "Due"}: {formatDateTime(job.scheduledFor)}</span>
        <span>Completed: {formatDateTime(job.completedAt)}</span>
        <span>Requested by: {job.requestedBy || "—"}</span>
      </div>

      {canWrite && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={routes.organisations.publishing.job(organisationId, job.id)}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            View attempts
          </Link>
          <Link
            href={routes.organisations.content.draft(organisationId, job.draftId)}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            Open draft
          </Link>

          {job.status === "failed" && job.retryCount < job.maxRetries && (
            <form action={retryAction}>
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="draftId" value={job.draftId} />
              <SubmitButton variant="secondary" pendingLabel="Retrying…">Retry Publish</SubmitButton>
            </form>
          )}

          {job.status === "queued" && (
            <form action={cancelAction}>
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="draftId" value={job.draftId} />
              <SubmitButton variant="ghost" className="text-danger hover:bg-danger/5" pendingLabel="Cancelling…">
                Cancel
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
