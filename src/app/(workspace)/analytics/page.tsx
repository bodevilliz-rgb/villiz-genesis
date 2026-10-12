import type { Metadata } from "next";
import { requireContext } from "@/server/container";
import { AnalyticsLiveView, type AnalyticsAttempt, type AnalyticsSnapshot } from "@/components/analytics/analytics-live-view";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const context = await requireContext();
  const organisations = await context.organisations.listForActor();
  const organisationNames = new Map(organisations.map((organisation) => [organisation.id, organisation.name]));
  const dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [publishingAttempts, publishingJobs, snapshotGroups] = await Promise.all([
    context.publishing.listAttemptsForAnalytics(undefined, { dateFrom, newestFirst: true, limit: 100 }),
    context.publishing.listJobsForAnalytics(undefined, { dateFrom }),
    Promise.all(
      organisations.map(async (organisation) => ({
        organisation,
        snapshots: context.engagement.listMetricSnapshotsForOrganisation
          ? await context.engagement.listMetricSnapshotsForOrganisation(organisation.id, 500)
          : [],
      })),
    ),
  ]);

  const snapshots: AnalyticsSnapshot[] = snapshotGroups.flatMap(({ organisation, snapshots: organisationSnapshots }) =>
    organisationSnapshots.map((snapshot) => ({
      publishingAttemptId: snapshot.publishingAttemptId,
      organisationId: snapshot.organisationId,
      organisationName: organisation.name,
      platform: snapshot.platform,
      observedAt: snapshot.observedAt,
      metrics: snapshot.metrics,
    })),
  );
  const captionPatternByAttempt = new Map(
    snapshotGroups.flatMap((group) =>
      group.snapshots.map((snapshot) => [snapshot.publishingAttemptId, snapshot.selectedVariant ?? "unclassified"] as const),
    ),
  );
  const jobsById = new Map(publishingJobs.map((job) => [job.id, job]));
  const attemptedJobIds = new Set(publishingAttempts.map((attempt) => attempt.jobId));

  const attempts: AnalyticsAttempt[] = [
    ...publishingAttempts.map((attempt) => {
      const job = jobsById.get(attempt.jobId);
      return {
        id: attempt.id,
        organisationId: attempt.organisationId,
        organisationName: organisationNames.get(attempt.organisationId) ?? "Client",
        platform: attempt.platform,
        status: attempt.status,
        externalUrl: attempt.externalUrl,
        externalPostId: attempt.externalPostId,
        createdAt: attempt.createdAt,
        scheduledFor: job?.scheduledFor ?? null,
        captionPattern: captionPatternByAttempt.get(attempt.id) ?? "unclassified",
      };
    }),
    ...publishingJobs
      .filter((job) => job.status === "queued" && !attemptedJobIds.has(job.id))
      .map((job) => ({
        id: `job-${job.id}`,
        organisationId: job.organisationId,
        organisationName: organisationNames.get(job.organisationId) ?? "Client",
        platform: job.platform,
        status: "queued",
        externalUrl: null,
        externalPostId: null,
        createdAt: job.createdAt,
        scheduledFor: job.scheduledFor,
        captionPattern: "unclassified",
      })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow="Analytics"
        title="Live signal, without guesswork"
        description="Publishing receipts and nightly Blotato checkpoints. Sparse or delayed provider data remains visibly pending until a verified snapshot arrives."
      />
      <AnalyticsLiveView attempts={attempts} snapshots={snapshots} updatedAt={new Date().toISOString()} />
    </div>
  );
}
