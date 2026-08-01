import {
  isTerminalPublishingJobStatus,
  PUBLISHING_PLATFORMS,
  type PublishingAnalytics,
  type PublishingAttempt,
  type PublishingJob,
  type PublishingPlatform,
  type PlatformAnalytics,
  type TriggerTypeAnalytics,
} from "@/core/domain/entities/publishing";

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Pure — every figure is derived only from the persisted jobs/attempts rows
 * passed in, never from content_drafts. `referenceDate` defaults to "now"
 * at the call site but is threaded through explicitly so tests are fully
 * deterministic (no hidden `new Date()` inside this function).
 */
export function computePublishingAnalytics(
  jobs: PublishingJob[],
  attempts: PublishingAttempt[],
  referenceDate: Date,
): PublishingAnalytics {
  const completedAttempts = attempts.filter((a) => a.status === "completed");
  const failedAttempts = attempts.filter((a) => a.status === "failed");
  const resolvedAttempts = completedAttempts.length + failedAttempts.length;

  const terminalJobs = jobs.filter((j) => isTerminalPublishingJobStatus(j.status));
  const publishedJobs = jobs.filter((j) => j.status === "published");

  const retryAttempts = attempts.filter((a) => a.attemptNumber > 1);
  const resolvedRetryAttempts = retryAttempts.filter((a) => a.status === "completed" || a.status === "failed");
  const successfulRetries = retryAttempts.filter((a) => a.status === "completed").length;

  const byTrigger = (triggerType: PublishingJob["triggerType"]): TriggerTypeAnalytics => {
    const triggerJobs = jobs.filter((j) => j.triggerType === triggerType);
    const triggerJobIds = new Set(triggerJobs.map((j) => j.id));
    const triggerCompletedDurations = completedAttempts
      .filter((a) => triggerJobIds.has(a.jobId) && a.durationMs !== null)
      .map((a) => a.durationMs as number);
    const triggerTerminalJobs = triggerJobs.filter((j) => isTerminalPublishingJobStatus(j.status));
    const triggerPublishedJobs = triggerJobs.filter((j) => j.status === "published");

    return {
      triggerType,
      jobCount: triggerJobs.length,
      averageDurationMs: average(triggerCompletedDurations),
      successRate: percentage(triggerPublishedJobs.length, triggerTerminalJobs.length),
    };
  };

  const platformBreakdown: PlatformAnalytics[] = PUBLISHING_PLATFORMS.map((platform: PublishingPlatform) => {
    const platformAttempts = attempts.filter((a) => a.platform === platform);
    const platformCompleted = platformAttempts.filter((a) => a.status === "completed");
    const platformFailed = platformAttempts.filter((a) => a.status === "failed");
    const platformResolved = platformCompleted.length + platformFailed.length;

    return {
      platform,
      totalAttempts: platformAttempts.length,
      successfulAttempts: platformCompleted.length,
      failedAttempts: platformFailed.length,
      successRate: percentage(platformCompleted.length, platformResolved),
      averagePublishTimeMs: average(
        platformCompleted.filter((a) => a.durationMs !== null).map((a) => a.durationMs as number),
      ),
    };
  });

  return {
    averagePublishTimeMs: average(
      completedAttempts.filter((a) => a.durationMs !== null).map((a) => a.durationMs as number),
    ),
    attemptSuccessRate: percentage(completedAttempts.length, resolvedAttempts),
    jobSuccessRate: percentage(publishedJobs.length, terminalJobs.length),
    failureRate: percentage(failedAttempts.length, resolvedAttempts),
    successfulRetries,
    retrySuccessRate: percentage(successfulRetries, resolvedRetryAttempts.length),
    scheduledPublications: jobs.filter((j) => j.triggerType === "scheduled" && j.status === "published").length,
    immediatePublications: jobs.filter((j) => j.triggerType === "immediate" && j.status === "published").length,
    jobsQueued: jobs.filter((j) => j.status === "queued").length,
    jobsProcessing: jobs.filter((j) => j.status === "processing").length,
    jobsFailedRequiringAttention: jobs.filter((j) => j.status === "failed").length,
    publishedToday: jobs.filter(
      (j) => j.status === "published" && j.completedAt !== null && isSameUtcDay(new Date(j.completedAt), referenceDate),
    ).length,
    scheduledVsImmediate: {
      scheduled: byTrigger("scheduled"),
      immediate: byTrigger("immediate"),
    },
    platformBreakdown,
  };
}
