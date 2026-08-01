import { describe, expect, it } from "vitest";
import { computePublishingAnalytics } from "@/core/application/use-cases/publishing/analytics";
import type { PublishingAttempt, PublishingJob } from "@/core/domain/entities/publishing";

const REFERENCE_DATE = new Date("2026-08-01T12:00:00.000Z");
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";

let jobSeq = 0;
function job(overrides: Partial<PublishingJob> = {}): PublishingJob {
  jobSeq += 1;
  return {
    id: `job-${jobSeq}`,
    organisationId: ORG_ID,
    draftId: DRAFT_ID,
    platform: "linkedin",
    triggerType: "immediate",
    scheduledFor: "2026-08-01T10:00:00.000Z",
    status: "published",
    idempotencyKey: `key-${jobSeq}`,
    requestedBy: "actor-1",
    requestedByProfile: { id: "actor-1", fullName: "Actor One", email: "actor@villiz.com" },
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:05.000Z",
    claimedBy: "worker-1",
    nextAttemptAt: null,
    retryCount: 0,
    maxRetries: 3,
    completedAt: "2026-08-01T10:00:05.000Z",
    cancelledAt: null,
    devSimulationMode: null,
    ...overrides,
  };
}

let attemptSeq = 0;
function attempt(overrides: Partial<PublishingAttempt> = {}): PublishingAttempt {
  attemptSeq += 1;
  return {
    id: `attempt-${attemptSeq}`,
    jobId: `job-${attemptSeq}`,
    organisationId: ORG_ID,
    draftId: DRAFT_ID,
    platform: "linkedin",
    attemptNumber: 1,
    status: "completed",
    queuedAt: "2026-08-01T10:00:00.000Z",
    startedAt: "2026-08-01T10:00:00.000Z",
    completedAt: "2026-08-01T10:00:01.000Z",
    failedAt: null,
    durationMs: 1000,
    externalPostId: "mock-linkedin-1",
    externalUrl: "https://mock.local/linkedin/mock-linkedin-1",
    errorCode: null,
    errorMessage: null,
    retryOfAttemptId: null,
    providerMetadata: {},
    createdAt: "2026-08-01T10:00:01.000Z",
    ...overrides,
  };
}

describe("computePublishingAnalytics — empty state", () => {
  it("returns zeroed figures and null averages for no data at all", () => {
    const analytics = computePublishingAnalytics([], [], REFERENCE_DATE);
    expect(analytics.averagePublishTimeMs).toBeNull();
    expect(analytics.attemptSuccessRate).toBeNull();
    expect(analytics.jobSuccessRate).toBeNull();
    expect(analytics.failureRate).toBeNull();
    expect(analytics.retrySuccessRate).toBeNull();
    expect(analytics.jobsQueued).toBe(0);
    expect(analytics.publishedToday).toBe(0);
    expect(analytics.platformBreakdown).toHaveLength(4);
    expect(analytics.platformBreakdown.every((p) => p.totalAttempts === 0)).toBe(true);
  });
});

describe("computePublishingAnalytics — average publish time", () => {
  it("averages durationMs of completed attempts only, ignoring failed ones", () => {
    const attempts = [
      attempt({ status: "completed", durationMs: 1000 }),
      attempt({ status: "completed", durationMs: 3000 }),
      attempt({ status: "failed", durationMs: 9000, completedAt: null, failedAt: "2026-08-01T10:00:01.000Z" }),
    ];
    const analytics = computePublishingAnalytics([], attempts, REFERENCE_DATE);
    expect(analytics.averagePublishTimeMs).toBe(2000);
  });
});

describe("computePublishingAnalytics — success/failure rates", () => {
  it("computes attemptSuccessRate and failureRate from completed+failed attempts only, excluding queued/started", () => {
    const attempts = [
      attempt({ status: "completed" }),
      attempt({ status: "completed" }),
      attempt({ status: "completed" }),
      attempt({ status: "failed" }),
      attempt({ status: "queued" }),
      attempt({ status: "started" }),
    ];
    const analytics = computePublishingAnalytics([], attempts, REFERENCE_DATE);
    // 3 completed / 4 resolved (completed+failed) = 75%
    expect(analytics.attemptSuccessRate).toBe(75);
    expect(analytics.failureRate).toBe(25);
  });

  it("computes jobSuccessRate from jobs reaching any terminal state (published/failed/cancelled)", () => {
    const jobs = [
      job({ status: "published" }),
      job({ status: "published" }),
      job({ status: "failed" }),
      job({ status: "cancelled" }),
      job({ status: "queued" }), // not terminal — excluded from denominator
      job({ status: "processing" }), // not terminal — excluded
    ];
    const analytics = computePublishingAnalytics(jobs, [], REFERENCE_DATE);
    // 2 published / 4 terminal (published+failed+cancelled) = 50%
    expect(analytics.jobSuccessRate).toBe(50);
  });
});

describe("computePublishingAnalytics — retry metrics", () => {
  it("counts successful retries as completed attempts with attemptNumber > 1, and computes retrySuccessRate over resolved retry attempts only", () => {
    const attempts = [
      attempt({ attemptNumber: 1, status: "failed" }),
      attempt({ attemptNumber: 2, status: "completed" }), // successful retry
      attempt({ attemptNumber: 1, status: "failed" }),
      attempt({ attemptNumber: 2, status: "failed" }), // unsuccessful retry
      attempt({ attemptNumber: 3, status: "queued" }), // unresolved retry — excluded from denominator
    ];
    const analytics = computePublishingAnalytics([], attempts, REFERENCE_DATE);
    expect(analytics.successfulRetries).toBe(1);
    // 1 successful / 2 resolved retry attempts (attempt 2 completed, attempt 2 failed) = 50%
    expect(analytics.retrySuccessRate).toBe(50);
  });
});

describe("computePublishingAnalytics — job status counts", () => {
  it("counts queued, processing, and failed-requiring-attention jobs directly from status", () => {
    const jobs = [
      job({ status: "queued" }),
      job({ status: "queued" }),
      job({ status: "processing" }),
      job({ status: "failed" }),
    ];
    const analytics = computePublishingAnalytics(jobs, [], REFERENCE_DATE);
    expect(analytics.jobsQueued).toBe(2);
    expect(analytics.jobsProcessing).toBe(1);
    expect(analytics.jobsFailedRequiringAttention).toBe(1);
  });
});

describe("computePublishingAnalytics — published today", () => {
  it("counts only published jobs whose completedAt falls on the same UTC day as referenceDate", () => {
    const jobs = [
      job({ status: "published", completedAt: "2026-08-01T09:00:00.000Z" }), // today
      job({ status: "published", completedAt: "2026-07-31T23:59:00.000Z" }), // yesterday
      job({ status: "published", completedAt: "2026-08-01T23:00:00.000Z" }), // today (still same UTC date)
      job({ status: "failed", completedAt: "2026-08-01T09:00:00.000Z" }), // not published
    ];
    const analytics = computePublishingAnalytics(jobs, [], REFERENCE_DATE);
    expect(analytics.publishedToday).toBe(2);
  });
});

describe("computePublishingAnalytics — scheduled vs immediate", () => {
  it("reports separate job counts, average duration, and success rate per trigger type", () => {
    const scheduledJob1 = job({ triggerType: "scheduled", status: "published" });
    const scheduledJob2 = job({ triggerType: "scheduled", status: "failed" });
    const immediateJob1 = job({ triggerType: "immediate", status: "published" });

    const jobs = [scheduledJob1, scheduledJob2, immediateJob1];
    const attempts = [
      attempt({ jobId: scheduledJob1.id, status: "completed", durationMs: 2000 }),
      attempt({ jobId: immediateJob1.id, status: "completed", durationMs: 1000 }),
    ];

    const analytics = computePublishingAnalytics(jobs, attempts, REFERENCE_DATE);
    expect(analytics.scheduledVsImmediate.scheduled.jobCount).toBe(2);
    expect(analytics.scheduledVsImmediate.scheduled.successRate).toBe(50); // 1 published / 2 terminal
    expect(analytics.scheduledVsImmediate.scheduled.averageDurationMs).toBe(2000);
    expect(analytics.scheduledVsImmediate.immediate.jobCount).toBe(1);
    expect(analytics.scheduledVsImmediate.immediate.successRate).toBe(100);
    expect(analytics.scheduledPublications).toBe(1);
    expect(analytics.immediatePublications).toBe(1);
  });
});

describe("computePublishingAnalytics — platform breakdown", () => {
  it("always returns exactly 4 platforms, each computed independently from the others' attempts", () => {
    const attempts = [
      attempt({ platform: "linkedin", status: "completed" }),
      attempt({ platform: "linkedin", status: "completed" }),
      attempt({ platform: "linkedin", status: "failed" }),
      attempt({ platform: "facebook", status: "completed" }),
    ];
    const analytics = computePublishingAnalytics([], attempts, REFERENCE_DATE);
    const platforms = new Set(analytics.platformBreakdown.map((p) => p.platform));
    expect(platforms).toEqual(new Set(["linkedin", "facebook", "instagram", "x"]));

    const linkedin = analytics.platformBreakdown.find((p) => p.platform === "linkedin");
    expect(linkedin?.totalAttempts).toBe(3);
    expect(linkedin?.successfulAttempts).toBe(2);
    expect(linkedin?.failedAttempts).toBe(1);
    expect(linkedin?.successRate).toBe(66.67); // 2/3 rounded to 2 decimal places

    const instagram = analytics.platformBreakdown.find((p) => p.platform === "instagram");
    expect(instagram?.totalAttempts).toBe(0);
    expect(instagram?.averagePublishTimeMs).toBeNull();
  });
});
