import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { canWriteContent } from "@/core/domain/entities/identity";
import { getPublishingAttempts, getPublishingJob } from "@/core/application/use-cases/publishing";
import { PageHeader } from "@/components/common/page-header";
import { AttemptTimeline } from "@/components/publishing/attempt-timeline";
import { PublishingJobRow } from "@/components/publishing/publishing-job-row";
import { NotFoundError } from "@/core/domain/errors";
import { routes } from "@/lib/routes";
import Link from "next/link";

export const metadata: Metadata = { title: "Publishing attempt history" };

export default async function PublishingJobDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; jobId: string }>;
}) {
  const { orgId, jobId } = await params;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const viewerRole = await context.organisations.viewerRole(orgId);
  const canWrite = context.actor.isPlatformAdmin || canWriteContent(context.actor, viewerRole);

  const deps = {
    actor: context.actor,
    publishing: context.publishing,
    content: context.content,
    organisations: context.organisations,
    audits: context.audits,
    notifications: context.notifications,
  };

  let job;
  try {
    job = await getPublishingJob(deps, orgId, jobId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [attempts, draft] = await Promise.all([
    getPublishingAttempts(deps, orgId, jobId),
    context.content.findDraft(orgId, job.draftId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Publishing Queue"
        title={draft?.title ?? "Untitled draft"}
        description="Every attempt is an immutable historical record — a retry always adds a new row, it never rewrites this timeline."
        actions={
          <Link href={routes.organisations.publishing.index(orgId)} className="text-[13px] font-medium text-primary hover:underline">
            Back to queue
          </Link>
        }
      />

      <PublishingJobRow organisationId={orgId} job={job} draftTitle={draft?.title ?? "Untitled draft"} canWrite={canWrite} />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Attempt history</h2>
        <AttemptTimeline attempts={attempts} />
      </div>
    </div>
  );
}
