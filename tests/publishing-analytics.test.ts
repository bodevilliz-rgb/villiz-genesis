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
    resolvedAccountId: null,
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
    expect(analytics.platformBreakdown).toHaveLength(5);
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
  it("always returns exactly 5 platforms, each computed independently from the others' attempts", () => {
    const attempts = [
      attempt({ platform: "linkedin", status: "completed" }),
      attempt({ platform: "linkedin", status: "completed" }),
      attempt({ platform: "linkedin", status: "failed" }),
      attempt({ platform: "facebook", status: "completed" }),
    ];
    const analytics = computePublishingAnalytics([], attempts, REFERENCE_DATE);
    const platforms = new Set(analytics.platformBreakdown.map((p) => p.platform));
    expect(platforms).toEqual(new Set(["linkedin", "facebook", "instagram", "x", "tiktok"]));

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

// ─────────────────────────────────────────────────────────────────────────────
// P0 audit — Publishing Queue KPI correction (fix/publishing-analytics-audit)
//
// Root causes proven against real production data (org "Mervic Signatures",
// e4684419-0b05-4e48-ad20-76bcb779062b):
//   - scheduledPublications/immediatePublications, jobSuccessRate,
//     attemptSuccessRate, failureRate, and publishedToday were ALREADY
//     computed from the correct authoritative fields (job.triggerType,
//     job.status, attempt.status, job.completedAt) — verified to reproduce
//     the exact displayed percentages (42.86%, 37.5%, 62.5%) from real rows.
//   - Two genuine defects: (1) successfulRetries/retrySuccessRate counted
//     reconcileBlotatoStatusTimeout's reconciliation attempt (attemptNumber
//     2, status completed, NEVER calls publishPost) as a provider retry
//     purely because attemptNumber > 1; (2) simulated attempts (BLOTATO_
//     LIVE_PUBLISHING_ENABLED off) were mixed into every live KPI with no
//     exclusion at all — 2 of 3 "Immediate Published" jobs for that
//     organisation were simulated smoke tests, not real Instagram posts.
//   - "Scheduled Published = 0" was proven to be CORRECT, not a bug: zero
//     jobs have ever been created with trigger_type='scheduled' in
//     production (confirmed via SQL) — both createImmediatePublishingJob
//     and createScheduledPublishingJob are correctly wired to their own
//     distinct UI actions; there is no code path that mislabels one as the
//     other. The formula already never infers trigger from execution time.
// ─────────────────────────────────────────────────────────────────────────────

function simulatedAttempt(overrides: Partial<PublishingAttempt> = {}): PublishingAttempt {
  return attempt({ providerMetadata: { simulated: true }, ...overrides });
}

function reconciliationAttempt(overrides: Partial<PublishingAttempt> = {}): PublishingAttempt {
  return attempt({
    attemptNumber: 2,
    status: "completed",
    providerMetadata: { reconciledFromAttemptId: "original-attempt-id" },
    ...overrides,
  });
}

describe("computePublishingAnalytics — scheduled vs immediate attribution (test 1, 2, 3)", () => {
  it("a published scheduled job increments Scheduled Published, not Immediate Published", () => {
    const scheduledJob = job({ triggerType: "scheduled", status: "published" });
    const analytics = computePublishingAnalytics([scheduledJob], [], REFERENCE_DATE);
    expect(analytics.scheduledPublications).toBe(1);
    expect(analytics.immediatePublications).toBe(0);
  });

  it("a published immediate job increments Immediate Published, not Scheduled Published", () => {
    const immediateJob = job({ triggerType: "immediate", status: "published" });
    const analytics = computePublishingAnalytics([immediateJob], [], REFERENCE_DATE);
    expect(analytics.immediatePublications).toBe(1);
    expect(analytics.scheduledPublications).toBe(0);
  });

  it("attribution is read from the job's own triggerType field, never inferred from scheduledFor or execution timing", () => {
    // A scheduled job executed well after its scheduledFor time (the normal
    // case — the worker only picks it up once due) must still attribute to
    // Scheduled Published.
    const scheduledJob = job({
      triggerType: "scheduled",
      status: "published",
      scheduledFor: "2026-07-01T10:00:00.000Z", // due long before it actually ran
      completedAt: "2026-08-01T09:00:00.000Z",
    });
    const analytics = computePublishingAnalytics([scheduledJob], [], REFERENCE_DATE);
    expect(analytics.scheduledPublications).toBe(1);
  });
});

describe("computePublishingAnalytics — reconciliation (test 4, 5, 6, 7)", () => {
  it("4: a job reconciled to published counts as a job success", () => {
    const reconciledJob = job({ status: "published" });
    const originalFailedAttempt = attempt({ jobId: reconciledJob.id, attemptNumber: 1, status: "failed", errorCode: "blotato_status_timeout" });
    const reconciliation = reconciliationAttempt({ jobId: reconciledJob.id, retryOfAttemptId: originalFailedAttempt.id });

    const analytics = computePublishingAnalytics([reconciledJob], [originalFailedAttempt, reconciliation], REFERENCE_DATE);
    expect(analytics.jobSuccessRate).toBe(100);
  });

  it("31 (fix/scheduled-publishing-integrity): a reconciled SCHEDULED job increments Scheduled Published, not Immediate Published, and is not a successful retry", () => {
    const reconciledScheduledJob = job({ triggerType: "scheduled", status: "published" });
    const originalFailedAttempt = attempt({ jobId: reconciledScheduledJob.id, attemptNumber: 1, status: "failed", errorCode: "blotato_status_timeout" });
    const reconciliation = reconciliationAttempt({ jobId: reconciledScheduledJob.id, retryOfAttemptId: originalFailedAttempt.id });

    const analytics = computePublishingAnalytics([reconciledScheduledJob], [originalFailedAttempt, reconciliation], REFERENCE_DATE);
    expect(analytics.scheduledPublications).toBe(1);
    expect(analytics.immediatePublications).toBe(0);
    expect(analytics.successfulRetries).toBe(0);
  });

  it("5: a reconciled job (status now published) does not count in Failed — Needs Attention", () => {
    const reconciledJob = job({ status: "published" }); // reconcileBlotatoStatusTimeout already flipped this
    const stillFailedJob = job({ status: "failed" });
    const analytics = computePublishingAnalytics([reconciledJob, stillFailedJob], [], REFERENCE_DATE);
    expect(analytics.jobsFailedRequiringAttention).toBe(1); // only the genuinely-still-failed job
  });

  it("6: the original timed-out attempt remains in attempt failure history even though the job ultimately published", () => {
    const reconciledJob = job({ status: "published" });
    const originalFailedAttempt = attempt({ jobId: reconciledJob.id, attemptNumber: 1, status: "failed", errorCode: "blotato_status_timeout" });
    const reconciliation = reconciliationAttempt({ jobId: reconciledJob.id, retryOfAttemptId: originalFailedAttempt.id });

    const analytics = computePublishingAnalytics([reconciledJob], [originalFailedAttempt, reconciliation], REFERENCE_DATE);
    // 1 completed (reconciliation) + 1 failed (original) = 2 resolved attempts, 50% attempt success
    expect(analytics.attemptSuccessRate).toBe(50);
    expect(analytics.failureRate).toBe(50);
  });

  it("7: a reconciliation-only attempt does NOT count as a provider retry", () => {
    const reconciledJob = job({ status: "published" });
    const originalFailedAttempt = attempt({ jobId: reconciledJob.id, attemptNumber: 1, status: "failed" });
    const reconciliation = reconciliationAttempt({ jobId: reconciledJob.id, retryOfAttemptId: originalFailedAttempt.id });

    const analytics = computePublishingAnalytics([reconciledJob], [originalFailedAttempt, reconciliation], REFERENCE_DATE);
    expect(analytics.successfulRetries).toBe(0);
    expect(analytics.retrySuccessRate).toBeNull(); // no genuine retry attempts to compute a rate from
  });
});

describe("computePublishingAnalytics — genuine retries vs reconciliation (test 8, 9)", () => {
  it("8: a genuine successful retry (attemptNumber > 1, NOT reconciliation) increments Successful Retries", () => {
    const retriedJob = job({ status: "published" });
    const firstAttempt = attempt({ jobId: retriedJob.id, attemptNumber: 1, status: "failed", errorCode: "blotato_no_connected_account" });
    const genuineRetry = attempt({ jobId: retriedJob.id, attemptNumber: 2, status: "completed", retryOfAttemptId: firstAttempt.id, providerMetadata: {} });

    const analytics = computePublishingAnalytics([retriedJob], [firstAttempt, genuineRetry], REFERENCE_DATE);
    expect(analytics.successfulRetries).toBe(1);
    expect(analytics.retrySuccessRate).toBe(100);
  });

  it("9: a failed genuine retry lowers retry success rate without being confused for reconciliation", () => {
    const attempts = [
      attempt({ attemptNumber: 1, status: "failed" }),
      attempt({ attemptNumber: 2, status: "completed", providerMetadata: {} }), // successful retry
      attempt({ attemptNumber: 1, status: "failed" }),
      attempt({ attemptNumber: 2, status: "failed", providerMetadata: {} }), // failed retry
    ];
    const analytics = computePublishingAnalytics([], attempts, REFERENCE_DATE);
    expect(analytics.successfulRetries).toBe(1);
    expect(analytics.retrySuccessRate).toBe(50); // 1 of 2 resolved genuine retries
  });

  it("a mix of one genuine retry and one reconciliation attempt separates cleanly — only the genuine retry counts", () => {
    const jobA = job({ status: "published" });
    const jobB = job({ status: "published" });
    const attempts = [
      attempt({ jobId: jobA.id, attemptNumber: 1, status: "failed" }),
      attempt({ jobId: jobA.id, attemptNumber: 2, status: "completed", providerMetadata: {} }), // genuine retry
      attempt({ jobId: jobB.id, attemptNumber: 1, status: "failed" }),
      reconciliationAttempt({ jobId: jobB.id }), // reconciliation, not a retry
    ];
    const analytics = computePublishingAnalytics([jobA, jobB], attempts, REFERENCE_DATE);
    expect(analytics.successfulRetries).toBe(1);
    expect(analytics.retrySuccessRate).toBe(100); // the one genuine retry attempt resolved successfully
  });
});

describe("computePublishingAnalytics — simulation exclusion (test 10)", () => {
  it("a simulated published job does not inflate jobSuccessRate, immediatePublications, or publishedToday", () => {
    const realJob = job({ triggerType: "immediate", status: "published", completedAt: "2026-08-01T09:00:00.000Z" });
    const realAttempt = attempt({ jobId: realJob.id, status: "completed", providerMetadata: {} });

    const simJob = job({ triggerType: "immediate", status: "published", completedAt: "2026-08-01T09:00:00.000Z" });
    const simAttempt = simulatedAttempt({ jobId: simJob.id });

    const analytics = computePublishingAnalytics([realJob, simJob], [realAttempt, simAttempt], REFERENCE_DATE);

    expect(analytics.immediatePublications).toBe(1); // simJob excluded
    expect(analytics.jobSuccessRate).toBe(100); // simJob never enters the terminal-jobs denominator
    expect(analytics.publishedToday).toBe(1); // simJob excluded
    expect(analytics.simulatedJobsExcluded).toBe(1);
  });

  it("a simulated FAILED job does not inflate Failed — Needs Attention or drag down job success rate", () => {
    const realPublished = job({ status: "published" });
    const realPublishedAttempt = attempt({ jobId: realPublished.id, status: "completed", providerMetadata: {} });

    const simFailed = job({ status: "failed" });
    const simFailedAttempt = simulatedAttempt({ jobId: simFailed.id, status: "failed", externalPostId: null, externalUrl: null });

    const analytics = computePublishingAnalytics([realPublished, simFailed], [realPublishedAttempt, simFailedAttempt], REFERENCE_DATE);
    expect(analytics.jobsFailedRequiringAttention).toBe(0);
    expect(analytics.jobSuccessRate).toBe(100);
    expect(analytics.simulatedJobsExcluded).toBe(1);
  });

  it("does not exclude a job with zero attempts (queued/processing) — only attempt-level evidence of simulation excludes a job", () => {
    const queuedJob = job({ status: "queued" });
    const analytics = computePublishingAnalytics([queuedJob], [], REFERENCE_DATE);
    expect(analytics.jobsQueued).toBe(1);
    expect(analytics.simulatedJobsExcluded).toBe(0);
  });

  it("reproduces the exact production figures for org e4684419 once simulated jobs are excluded (2 sim published + 1 real published + 4 real failed)", () => {
    const simJob1 = job({ status: "published", completedAt: "2026-08-08T14:59:16.872Z" });
    const simAttempt1 = simulatedAttempt({ jobId: simJob1.id });
    const simJob2 = job({ status: "published", completedAt: "2026-08-08T19:51:01.739Z" });
    const simAttempt2 = simulatedAttempt({ jobId: simJob2.id });

    const failedJob1 = job({ status: "failed" });
    const failedAttempt1 = attempt({ jobId: failedJob1.id, status: "failed", providerMetadata: {} });
    const failedJob2 = job({ status: "failed" });
    const failedAttempt2 = attempt({ jobId: failedJob2.id, status: "failed", providerMetadata: {} });
    const failedJob3 = job({ status: "failed" });
    const failedAttempt3 = attempt({ jobId: failedJob3.id, status: "failed", providerMetadata: {} });
    const failedJob4 = job({ status: "failed" });
    const failedAttempt4 = attempt({ jobId: failedJob4.id, status: "failed", providerMetadata: {} });

    const reconciledJob = job({ status: "published", completedAt: "2026-08-09T14:42:37.736Z" });
    const reconciledOriginal = attempt({ jobId: reconciledJob.id, attemptNumber: 1, status: "failed", providerMetadata: {} });
    const reconciledCompletion = reconciliationAttempt({ jobId: reconciledJob.id, retryOfAttemptId: reconciledOriginal.id });

    const analytics = computePublishingAnalytics(
      [simJob1, simJob2, failedJob1, failedJob2, failedJob3, failedJob4, reconciledJob],
      [simAttempt1, simAttempt2, failedAttempt1, failedAttempt2, failedAttempt3, failedAttempt4, reconciledOriginal, reconciledCompletion],
      new Date("2026-08-09T18:00:00.000Z"),
    );

    // Live figures with simulation excluded: 1 published (reconciled), 4 failed = 5 live terminal jobs.
    expect(analytics.jobSuccessRate).toBe(20); // 1 / 5 — down from the contaminated 42.86% (3/7)
    expect(analytics.immediatePublications).toBe(1); // down from the contaminated 3
    expect(analytics.jobsFailedRequiringAttention).toBe(4);
    expect(analytics.publishedToday).toBe(1); // only the reconciled job completed on 2026-08-09
    expect(analytics.simulatedJobsExcluded).toBe(2);
    expect(analytics.successfulRetries).toBe(0); // the only attemptNumber>1 completed attempt is the reconciliation
  });
});

describe("computePublishingAnalytics — organisation isolation (test 16, 17)", () => {
  it("figures reflect only the jobs/attempts passed in — Alpha and Beta computed independently never mix", () => {
    const alphaJob = job({ organisationId: "alpha-org", status: "published" });
    const alphaAttempt = attempt({ jobId: alphaJob.id, organisationId: "alpha-org", status: "completed", providerMetadata: {} });
    const betaJob1 = job({ organisationId: "beta-org", status: "failed" });
    const betaJob2 = job({ organisationId: "beta-org", status: "failed" });
    const betaAttempt1 = attempt({ jobId: betaJob1.id, organisationId: "beta-org", status: "failed", providerMetadata: {} });
    const betaAttempt2 = attempt({ jobId: betaJob2.id, organisationId: "beta-org", status: "failed", providerMetadata: {} });

    const alphaAnalytics = computePublishingAnalytics([alphaJob], [alphaAttempt], REFERENCE_DATE);
    const betaAnalytics = computePublishingAnalytics([betaJob1, betaJob2], [betaAttempt1, betaAttempt2], REFERENCE_DATE);

    expect(alphaAnalytics.jobSuccessRate).toBe(100);
    expect(alphaAnalytics.jobsFailedRequiringAttention).toBe(0);
    expect(betaAnalytics.jobSuccessRate).toBe(0);
    expect(betaAnalytics.jobsFailedRequiringAttention).toBe(2);
  });
});
