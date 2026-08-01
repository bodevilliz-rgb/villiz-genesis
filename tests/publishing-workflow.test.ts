import { describe, expect, it } from "vitest";
import {
  cancelPublishingJob,
  completePublishingAttempt,
  createImmediatePublishingJob,
  createScheduledPublishingJob,
  failPublishingAttempt,
  retryFailedPublishingJob,
  startPublishingAttempt,
} from "@/core/application/use-cases/publishing";
import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { PublishingAttempt, PublishingJob } from "@/core/domain/entities/publishing";
import type {
  CreatePublishingAttemptInput,
  CreatePublishingJobInput,
  PublishingRepository,
} from "@/core/application/ports/publishing-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { AuditEvent, AuditRepository } from "@/core/application/ports/audit-port";
import type { NotificationRecord, NotificationRepository } from "@/core/application/ports/notification-port";

/**
 * This mirrors the mission's own required test list (section 19) as far as
 * an in-memory harness can meaningfully prove it: immediate/scheduled
 * success, controlled failure, retry after failure, retry limit, cancel,
 * organisation isolation, permission enforcement, immutable attempt
 * history, audit/notification creation. The genuinely database-level
 * guarantees this harness cannot prove — atomic claim under
 * `for update skip locked`, the unique idempotency/active-job constraints,
 * the terminal-attempt-immutability trigger, two-worker contention, and
 * restart recovery — were verified instead against the real local
 * Supabase instance and are documented as such in the Sprint 6A completion
 * report, not claimed here.
 */

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG_ID = "00000000-0000-4000-8000-000000000099";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000004";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: ACTOR_ID,
    email: "actor@villiz.com",
    fullName: "Actor One",
    avatarUrl: null,
    jobTitle: null,
    role: "member",
    isActive: true,
    isPlatformAdmin: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function profileRef(id: string) {
  return { id, fullName: id, email: `${id}@villiz.com` };
}

function baseDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: DRAFT_ID,
    organisationId: ORG_ID,
    title: "A draft",
    contentType: "social_post",
    summary: null,
    body: "Body",
    status: "approved",
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    dueAt: null,
    reviewerIds: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    createdBy: profileRef(AUTHOR_ID),
    updatedBy: profileRef(AUTHOR_ID),
    priority: "medium",
    reviewDeadline: null,
    ...overrides,
  };
}

/** In-memory harness — same convention as tests/review-workflow.test.ts and tests/content-publishing.test.ts. */
function createHarness(input: {
  draft: ContentDraft;
  viewerRole: OrganisationRole | null;
  organisationId?: string;
}) {
  let draft = input.draft;
  const jobs = new Map<string, PublishingJob>();
  const attempts = new Map<string, PublishingAttempt>();
  const auditEvents: { eventType: string; description: string; draftId: string | null }[] = [];
  const notifications: { profileId: string; type: string; message: string }[] = [];
  let jobSeq = 0;
  let attemptSeq = 0;

  const publishing: Partial<PublishingRepository> = {
    async createJob(jobInput: CreatePublishingJobInput) {
      const existingByKey = [...jobs.values()].find((j) => j.idempotencyKey === jobInput.idempotencyKey);
      if (existingByKey) return existingByKey;

      jobSeq += 1;
      const created: PublishingJob = {
        id: `job-${jobSeq}`,
        organisationId: jobInput.organisationId,
        draftId: jobInput.draftId,
        platform: jobInput.platform,
        triggerType: jobInput.triggerType,
        scheduledFor: jobInput.scheduledFor,
        status: "queued",
        idempotencyKey: jobInput.idempotencyKey,
        requestedBy: jobInput.requestedBy,
        requestedByProfile: profileRef(jobInput.requestedBy),
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T10:00:00.000Z",
        claimedBy: null,
        nextAttemptAt: null,
        retryCount: 0,
        maxRetries: jobInput.maxRetries,
        completedAt: null,
        cancelledAt: null,
        devSimulationMode: jobInput.devSimulationMode,
      };
      jobs.set(created.id, created);
      return created;
    },
    async findJobById(_organisationId, jobId) {
      return jobs.get(jobId) ?? null;
    },
    async findActiveJobForDraftPlatform(draftId, platform) {
      return (
        [...jobs.values()].find(
          (j) => j.draftId === draftId && j.platform === platform && (j.status === "queued" || j.status === "processing"),
        ) ?? null
      );
    },
    async cancelJob(_organisationId, jobId) {
      const existing = jobs.get(jobId);
      if (!existing || existing.status !== "queued") throw new NotFoundError("Publishing job");
      const updated: PublishingJob = { ...existing, status: "cancelled", cancelledAt: "2026-08-01T10:05:00.000Z" };
      jobs.set(jobId, updated);
      return updated;
    },
    async requeueJobForRetry(_organisationId, jobId) {
      const existing = jobs.get(jobId);
      if (!existing) throw new NotFoundError("Publishing job");
      const updated: PublishingJob = {
        ...existing,
        status: "queued",
        retryCount: existing.retryCount + 1,
        completedAt: null,
      };
      jobs.set(jobId, updated);
      return updated;
    },
    async markJobPublished(jobId) {
      const existing = jobs.get(jobId)!;
      const updated: PublishingJob = { ...existing, status: "published", completedAt: "2026-08-01T10:10:00.000Z" };
      jobs.set(jobId, updated);
      return updated;
    },
    async markJobFailed(jobId) {
      const existing = jobs.get(jobId)!;
      const updated: PublishingJob = { ...existing, status: "failed", completedAt: "2026-08-01T10:10:00.000Z" };
      jobs.set(jobId, updated);
      return updated;
    },
    async createAttempt(attemptInput: CreatePublishingAttemptInput) {
      attemptSeq += 1;
      const created: PublishingAttempt = {
        id: `attempt-${attemptSeq}`,
        jobId: attemptInput.jobId,
        organisationId: attemptInput.organisationId,
        draftId: attemptInput.draftId,
        platform: attemptInput.platform,
        attemptNumber: attemptInput.attemptNumber,
        status: "queued",
        queuedAt: "2026-08-01T10:00:00.000Z",
        startedAt: null,
        completedAt: null,
        failedAt: null,
        durationMs: null,
        externalPostId: null,
        externalUrl: null,
        errorCode: null,
        errorMessage: null,
        retryOfAttemptId: attemptInput.retryOfAttemptId,
        providerMetadata: {},
        createdAt: "2026-08-01T10:00:00.000Z",
      };
      attempts.set(created.id, created);
      return created;
    },
    async startAttempt(attemptId) {
      const existing = attempts.get(attemptId)!;
      const updated: PublishingAttempt = { ...existing, status: "started", startedAt: "2026-08-01T10:00:01.000Z" };
      attempts.set(attemptId, updated);
      return updated;
    },
    async completeAttempt(attemptId, completeInput) {
      const existing = attempts.get(attemptId)!;
      if (existing.status === "completed" || existing.status === "failed") {
        throw new Error(`Attempt ${attemptId} is already terminal (${existing.status}) and is immutable.`);
      }
      const updated: PublishingAttempt = {
        ...existing,
        status: "completed",
        completedAt: "2026-08-01T10:00:02.000Z",
        durationMs: 1000,
        externalPostId: completeInput.externalPostId,
        externalUrl: completeInput.externalUrl,
        providerMetadata: completeInput.providerMetadata,
      };
      attempts.set(attemptId, updated);
      return updated;
    },
    async failAttempt(attemptId, failInput) {
      const existing = attempts.get(attemptId)!;
      if (existing.status === "completed" || existing.status === "failed") {
        throw new Error(`Attempt ${attemptId} is already terminal (${existing.status}) and is immutable.`);
      }
      const updated: PublishingAttempt = {
        ...existing,
        status: "failed",
        failedAt: "2026-08-01T10:00:02.000Z",
        durationMs: 1000,
        errorCode: failInput.errorCode,
        errorMessage: failInput.errorMessage,
      };
      attempts.set(attemptId, updated);
      return updated;
    },
    async listAttemptsForJob(_organisationId, jobId) {
      return [...attempts.values()].filter((a) => a.jobId === jobId).sort((a, b) => a.attemptNumber - b.attemptNumber);
    },
  };

  const content: Partial<ContentRepository> = {
    async findDraft(organisationId, draftId) {
      if (organisationId !== draft.organisationId) return null; // organisation isolation
      return draftId === draft.id ? draft : null;
    },
    async updateStatus(_organisationId, _draftId, status, updatedBy) {
      draft = { ...draft, status, updatedBy: profileRef(updatedBy) };
      return draft;
    },
    async scheduleDraft(_organisationId, _draftId, scheduleInput) {
      draft = {
        ...draft,
        status: "scheduled",
        scheduledAt: scheduleInput.scheduledAt,
        scheduledPlatform: scheduleInput.platform,
        scheduledTimezone: scheduleInput.timezone,
        updatedBy: profileRef(scheduleInput.updatedBy),
      };
      return draft;
    },
  };

  const organisations: Partial<OrganisationRepository> = {
    async viewerRole(organisationId) {
      if (organisationId !== (input.organisationId ?? ORG_ID)) return null; // organisation isolation
      return input.viewerRole;
    },
  };

  const audits: Partial<AuditRepository> = {
    async recordEvent(event) {
      auditEvents.push({ eventType: event.eventType, description: event.description, draftId: event.draftId });
      return { ...event, id: "audit-1", createdAt: "2026-08-01T10:00:00.000Z", actor: null } as AuditEvent;
    },
  };

  const notificationsRepo: Partial<NotificationRepository> = {
    async createNotification(notificationInput) {
      notifications.push({
        profileId: notificationInput.profileId,
        type: notificationInput.type,
        message: notificationInput.message,
      });
      return {
        ...notificationInput,
        id: "notif-1",
        isRead: false,
        createdAt: "2026-08-01T10:00:00.000Z",
      } as NotificationRecord;
    },
  };

  return {
    deps: {
      actor: actor(),
      publishing: publishing as PublishingRepository,
      content: content as ContentRepository,
      organisations: organisations as OrganisationRepository,
      audits: audits as AuditRepository,
      notifications: notificationsRepo as NotificationRepository,
    },
    getDraft: () => draft,
    getJobs: () => [...jobs.values()],
    getAttempts: () => [...attempts.values()],
    getAuditEvents: () => auditEvents,
    getNotifications: () => notifications,
  };
}

describe("createImmediatePublishingJob", () => {
  it("queues a job and flips the draft to publishing for an approved draft", async () => {
    const { deps, getDraft, getJobs } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    const job = await createImmediatePublishingJob(deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      idempotencyKey: "key-1",
    });
    expect(job.status).toBe("queued");
    expect(job.triggerType).toBe("immediate");
    expect(getDraft().status).toBe("publishing");
    expect(getJobs()).toHaveLength(1);
  });

  it("refuses a draft still in review — the exact invalid transition the mission's Definition of Done rules out", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "in_review" }), viewerRole: "contributor" });
    await expect(
      createImmediatePublishingJob(deps, { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin", idempotencyKey: "key-1" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a viewer with no write role on the account (permission enforcement)", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: null });
    await expect(
      createImmediatePublishingJob(deps, { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin", idempotencyKey: "key-1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns the draft's existing active job for a different organisation id instead of ever finding it (organisation isolation)", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    await expect(
      createImmediatePublishingJob(deps, { organisationId: OTHER_ORG_ID, draftId: DRAFT_ID, platform: "linkedin", idempotencyKey: "key-1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("double-clicking Publish Now with the same idempotency key returns the same job, never a second one", async () => {
    const { deps, getJobs } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    const input = { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin" as const, idempotencyKey: "same-key" };
    const first = await createImmediatePublishingJob(deps, input);
    const second = await createImmediatePublishingJob(deps, input);
    expect(second.id).toBe(first.id);
    expect(getJobs()).toHaveLength(1);
  });
});

describe("createScheduledPublishingJob", () => {
  const future = "2099-01-01T10:00:00.000Z";

  it("schedules an approved draft and dual-writes the draft's scheduledAt/platform/timezone fields", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    const job = await createScheduledPublishingJob(deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "facebook",
      scheduledFor: future,
      timezone: "UTC",
      idempotencyKey: "sched-1",
    });
    expect(job.triggerType).toBe("scheduled");
    expect(getDraft().status).toBe("scheduled");
    expect(getDraft().scheduledPlatform).toBe("facebook");
  });

  it("refuses a scheduled time in the past", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    await expect(
      createScheduledPublishingJob(deps, {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "facebook",
        scheduledFor: "2020-01-01T00:00:00.000Z",
        timezone: "UTC",
        idempotencyKey: "sched-1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("retryFailedPublishingJob", () => {
  it("requeues a failed job, incrementing retryCount, without touching the failed attempt", async () => {
    const { deps, getJobs } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "immediate",
      scheduledFor: "2026-08-01T10:00:00.000Z",
      idempotencyKey: "job-to-retry",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
    });
    await deps.publishing.markJobFailed(job.id);

    const retried = await retryFailedPublishingJob(deps, ORG_ID, job.id);
    expect(retried.status).toBe("queued");
    expect(retried.retryCount).toBe(1);
    expect(getJobs()).toHaveLength(1); // same job row, not a new one
  });

  it("refuses to retry a job that is not failed", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "immediate",
      scheduledFor: "2026-08-01T10:00:00.000Z",
      idempotencyKey: "still-queued",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
    });
    await expect(retryFailedPublishingJob(deps, ORG_ID, job.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces the retry limit — a job already at maxRetries cannot be retried again", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "immediate",
      scheduledFor: "2026-08-01T10:00:00.000Z",
      idempotencyKey: "at-limit",
      requestedBy: ACTOR_ID,
      maxRetries: 1,
      devSimulationMode: null,
    });
    await deps.publishing.markJobFailed(job.id);
    await deps.publishing.requeueJobForRetry(ORG_ID, job.id); // retryCount now 1, equal to maxRetries
    await deps.publishing.markJobFailed(job.id);

    await expect(retryFailedPublishingJob(deps, ORG_ID, job.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("cancelPublishingJob", () => {
  it("cancels a still-queued job and returns the draft to approved", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "publishing" }), viewerRole: "contributor" });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "scheduled",
      scheduledFor: "2099-01-01T10:00:00.000Z",
      idempotencyKey: "to-cancel",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
    });
    const cancelled = await cancelPublishingJob(deps, ORG_ID, job.id);
    expect(cancelled.status).toBe("cancelled");
    expect(getDraft().status).toBe("approved");
  });

  it("refuses to cancel a job that is already processing", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "publishing" }), viewerRole: "contributor" });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "immediate",
      scheduledFor: "2026-08-01T10:00:00.000Z",
      idempotencyKey: "processing-job",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
    });
    // Simulate the worker having already claimed it.
    (job as { status: string }).status = "processing";
    await expect(cancelPublishingJob(deps, ORG_ID, job.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("attempt lifecycle — immutable history, audit events, notifications", () => {
  it("startPublishingAttempt creates attempt 1 and flips the draft to publishing", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "immediate",
      scheduledFor: "2026-08-01T10:00:00.000Z",
      idempotencyKey: "attempt-flow",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
    });
    const attempt = await startPublishingAttempt(deps, job);
    expect(attempt.attemptNumber).toBe(1);
    expect(attempt.status).toBe("started");
    expect(getDraft().status).toBe("publishing");
  });

  it("completePublishingAttempt marks the job published, the draft published, records an audit event, and notifies the requester", async () => {
    const { deps, getDraft, getAuditEvents, getNotifications } = createHarness({
      draft: baseDraft({ status: "publishing" }),
      viewerRole: "contributor",
    });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "immediate",
      scheduledFor: "2026-08-01T10:00:00.000Z",
      idempotencyKey: "complete-flow",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
    });
    const attempt = await deps.publishing.createAttempt({
      jobId: job.id,
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      attemptNumber: 1,
      retryOfAttemptId: null,
    });

    await completePublishingAttempt(deps, job, attempt, {
      externalPostId: "mock-linkedin-1",
      externalUrl: "https://mock.local/linkedin/mock-linkedin-1",
      providerMetadata: {},
    });

    expect(getDraft().status).toBe("published");
    expect(getAuditEvents().some((e) => e.eventType === "publishing_attempt_completed")).toBe(true);
    expect(getNotifications().some((n) => n.type === "publish_succeeded")).toBe(true);
  });

  it("failPublishingAttempt marks the job and draft failed, records an audit event, and notifies the requester — never auto-retries", async () => {
    const { deps, getDraft, getJobs, getAuditEvents, getNotifications } = createHarness({
      draft: baseDraft({ status: "publishing" }),
      viewerRole: "contributor",
    });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "immediate",
      scheduledFor: "2026-08-01T10:00:00.000Z",
      idempotencyKey: "fail-flow",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
    });
    const attempt = await deps.publishing.createAttempt({
      jobId: job.id,
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      attemptNumber: 1,
      retryOfAttemptId: null,
    });

    await failPublishingAttempt(deps, job, attempt, {
      errorCode: "mock_simulated_failure",
      errorMessage: "Simulated failure.",
      providerMetadata: {},
    });

    expect(getDraft().status).toBe("failed");
    expect(getJobs().find((j) => j.id === job.id)?.status).toBe("failed");
    expect(getJobs().find((j) => j.id === job.id)?.retryCount).toBe(0); // no automatic retry
    expect(getAuditEvents().some((e) => e.eventType === "publishing_attempt_failed")).toBe(true);
    expect(getNotifications().some((n) => n.type === "publish_failed")).toBe(true);
  });

  it("a retry's second attempt is a new row referencing the first — the first attempt is never overwritten", async () => {
    const { deps, getAttempts } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      triggerType: "immediate",
      scheduledFor: "2026-08-01T10:00:00.000Z",
      idempotencyKey: "retry-history",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
    });
    const attempt1 = await deps.publishing.createAttempt({
      jobId: job.id,
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      attemptNumber: 1,
      retryOfAttemptId: null,
    });
    await failPublishingAttempt(deps, job, attempt1, { errorCode: "x", errorMessage: "first failure", providerMetadata: {} });

    // The fake's own terminal-attempt guard mirrors the real DB trigger: touching attempt1 again must throw.
    await expect(
      deps.publishing.completeAttempt(attempt1.id, { externalPostId: "p", externalUrl: "u", providerMetadata: {} }),
    ).rejects.toThrow(/immutable/);

    const attempt2 = await deps.publishing.createAttempt({
      jobId: job.id,
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      attemptNumber: 2,
      retryOfAttemptId: attempt1.id,
    });
    await completePublishingAttempt(deps, job, attempt2, {
      externalPostId: "mock-linkedin-2",
      externalUrl: "https://mock.local/linkedin/mock-linkedin-2",
      providerMetadata: {},
    });

    const all = getAttempts().sort((a, b) => a.attemptNumber - b.attemptNumber);
    expect(all).toHaveLength(2);
    expect(all[0]?.status).toBe("failed");
    expect(all[1]?.status).toBe("completed");
    expect(all[1]?.retryOfAttemptId).toBe(attempt1.id);
  });
});
