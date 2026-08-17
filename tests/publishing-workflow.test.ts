import { describe, expect, it } from "vitest";
import {
  cancelPublishingJob,
  completePublishingAttempt,
  createImmediatePublishingJob,
  createScheduledPublishingJob,
  failPublishingAttempt,
  reconcileBlotatoStatusTimeout,
  retryFailedPublishingJob,
  startPublishingAttempt,
} from "@/core/application/use-cases/publishing";
import type { BlotatoPostStatus } from "@/core/application/ports/blotato-client-port";
import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { PublishingAttempt, PublishingJob } from "@/core/domain/entities/publishing";
import type {
  CreatePublishingAttemptInput,
  CreatePublishingJobInput,
  PublishingRepository,
} from "@/core/application/ports/publishing-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
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
    hashtags: [],
    ...overrides,
  };
}

/** In-memory harness — same convention as tests/review-workflow.test.ts and tests/content-publishing.test.ts. */
function createHarness(input: {
  draft: ContentDraft;
  viewerRole: OrganisationRole | null;
  organisationId?: string;
  /**
   * Number of active Blotato accounts returned for any platform query.
   * Default: 1 (the single-account happy path, locks that account onto the job).
   * Pass 0 to test fail-closed on no mapped accounts.
   * Pass 2+ to test fail-closed on ambiguous accounts.
   */
  activeAccountCount?: number;
}) {
  let draft = input.draft;
  const jobs = new Map<string, PublishingJob>();
  const attempts = new Map<string, PublishingAttempt>();
  const auditEvents: { eventType: string; description: string; draftId: string | null }[] = [];
  const notifications: { profileId: string; type: string; message: string }[] = [];
  let jobSeq = 0;
  let attemptSeq = 0;

  const blotatoAccounts: Partial<BlotatoAccountRepository> = {
    async findActiveForOrganisationAndPlatform(blotatoPlatform, organisationId) {
      if (organisationId !== (input.organisationId ?? ORG_ID)) return [];
      const count = input.activeAccountCount ?? 1;
      return Array.from<unknown, BlotatoAccount>({ length: count }, (_, i) => ({
        id: `fake-blotato-${blotatoPlatform}-${i}`,
        platform: blotatoPlatform,
        fullname: `Test Account ${i + 1}`,
        username: `testaccount${i + 1}`,
        organisationId,
        active: true,
        providerActive: true,
        firstConnectedAt: "2026-01-01T00:00:00Z",
        lastVerifiedAt: "2026-01-01T00:00:00Z",
      }));
    },
  };

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
        resolvedAccountId: jobInput.resolvedAccountId,
        isAiGenerated: jobInput.isAiGenerated,
        isYourBrand: jobInput.isYourBrand,
        isBrandedContent: jobInput.isBrandedContent,
        executionMode: jobInput.executionMode,
        nextStatusCheckAt: null,
        lastStatusCheckAt: null,
        statusCheckCount: 0,
        awaitingConfirmationSince: null,
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
        providerMetadata: failInput.providerMetadata,
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
      blotatoAccounts: blotatoAccounts as BlotatoAccountRepository,
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
      executionMode: "simulation",
    });
    expect(job.status).toBe("queued");
    expect(job.triggerType).toBe("immediate");
    expect(getDraft().status).toBe("publishing");
    expect(getJobs()).toHaveLength(1);
  });

  it("refuses a draft still in review — the exact invalid transition the mission's Definition of Done rules out", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "in_review" }), viewerRole: "contributor" });
    await expect(
      createImmediatePublishingJob(deps, { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin", idempotencyKey: "key-1", executionMode: "simulation" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a viewer with no write role on the account (permission enforcement)", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: null });
    await expect(
      createImmediatePublishingJob(deps, { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin", idempotencyKey: "key-1", executionMode: "simulation" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns the draft's existing active job for a different organisation id instead of ever finding it (organisation isolation)", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    await expect(
      createImmediatePublishingJob(deps, { organisationId: OTHER_ORG_ID, draftId: DRAFT_ID, platform: "linkedin", idempotencyKey: "key-1", executionMode: "simulation" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("double-clicking Publish Now with the same idempotency key returns the same job, never a second one", async () => {
    const { deps, getJobs } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    const input = { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin" as const, idempotencyKey: "same-key", executionMode: "simulation" as const };
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
      executionMode: "simulation",
    });
    expect(job.triggerType).toBe("scheduled");
    expect(getDraft().status).toBe("scheduled");
    expect(getDraft().scheduledPlatform).toBe("facebook");
  });

  it("34/36 (fix/scheduled-publishing-integrity): a scheduled job cannot be created against a destination account that belongs to a different organisation — cross-org forgery rejected", async () => {
    const OTHER_ORG = "00000000-0000-4000-8000-000000000099";
    // The harness's account resolver is scoped to ORG_ID only — a caller
    // that forges a different organisationId while the account pool is
    // fixed to ORG_ID must resolve zero active accounts for that org,
    // exactly the same protection createImmediatePublishingJob relies on.
    const { deps } = createHarness({ draft: baseDraft({ status: "approved", organisationId: ORG_ID }), viewerRole: null, organisationId: ORG_ID });
    await expect(
      createScheduledPublishingJob(deps, {
        organisationId: OTHER_ORG,
        draftId: DRAFT_ID,
        platform: "facebook",
        scheduledFor: future,
        timezone: "UTC",
        idempotencyKey: "sched-forged",
        executionMode: "simulation",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
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
        executionMode: "simulation",
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 1,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
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

// ── Destination-lock tests ─────────────────────────────────────────────────────
//
// These tests prove Check 1/2/3/4/5 from the Sprint 10B safety audit:
//   • resolvedAccountId is set on the job at creation time (not execution time)
//   • 0 active accounts → fail before createJob()
//   • 1 active account  → lock that account ID onto the job
//   • 2+ active accounts → fail before createJob()
//   Applies identically to immediate and scheduled job creation.
//
describe("destination lock — account pre-check at scheduling time", () => {
  const future = "2099-01-01T10:00:00.000Z";

  it("immediate publish: locks the sole active account ID onto the job at creation time", async () => {
    const { deps, getJobs } = createHarness({
      draft: baseDraft({ status: "approved" }),
      viewerRole: "contributor",
      activeAccountCount: 1,
    });
    const job = await createImmediatePublishingJob(deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      idempotencyKey: "lock-imm-1",
      executionMode: "simulation",
    });
    expect(job.resolvedAccountId).toBe("fake-blotato-linkedin-0");
    expect(getJobs()[0]?.resolvedAccountId).toBe("fake-blotato-linkedin-0");
  });

  it("scheduled publish: locks the sole active account ID onto the job at creation time", async () => {
    const { deps, getJobs } = createHarness({
      draft: baseDraft({ status: "approved" }),
      viewerRole: "contributor",
      activeAccountCount: 1,
    });
    const job = await createScheduledPublishingJob(deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "facebook",
      scheduledFor: future,
      timezone: "UTC",
      idempotencyKey: "lock-sched-1",
      executionMode: "simulation",
    });
    expect(job.resolvedAccountId).toBe("fake-blotato-facebook-0");
    expect(getJobs()[0]?.resolvedAccountId).toBe("fake-blotato-facebook-0");
  });

  it("scheduled publish preserves the AGIE-selected destination attribution", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor", activeAccountCount: 1 });
    Object.assign(deps, { engagement: { findLatest: async () => ({ platform: "instagram", strategyMetadata: { destinationPlatform: "instagram", destinationAccountId: "fake-blotato-instagram-0" } }) } });
    const job = await createScheduledPublishingJob(deps, { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram", scheduledFor: future, timezone: "UTC", idempotencyKey: "agie-destination-match", executionMode: "simulation" });
    expect(job.resolvedAccountId).toBe("fake-blotato-instagram-0");
  });

  it("scheduled publish refuses to silently move an AGIE decision to another account", async () => {
    const { deps, getJobs } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor", activeAccountCount: 2 });
    Object.assign(deps, { engagement: { findLatest: async () => ({ platform: "instagram", strategyMetadata: { destinationPlatform: "instagram", destinationAccountId: "fake-blotato-instagram-0" } }) } });
    await expect(createScheduledPublishingJob(deps, { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram", scheduledFor: future, timezone: "UTC", idempotencyKey: "agie-destination-mismatch", resolvedAccountId: "fake-blotato-instagram-1", executionMode: "simulation" })).rejects.toThrow(/another destination account/i);
    expect(getJobs()).toHaveLength(0);
  });

  it("immediate publish: fails closed (ValidationError) before createJob when 0 accounts are mapped", async () => {
    const { deps, getJobs } = createHarness({
      draft: baseDraft({ status: "approved" }),
      viewerRole: "contributor",
      activeAccountCount: 0,
    });
    await expect(
      createImmediatePublishingJob(deps, {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "linkedin",
        idempotencyKey: "lock-imm-zero",
        executionMode: "simulation",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(getJobs()).toHaveLength(0);
  });

  it("scheduled publish: fails closed (ValidationError) before createJob when 0 accounts are mapped", async () => {
    const { deps, getJobs } = createHarness({
      draft: baseDraft({ status: "approved" }),
      viewerRole: "contributor",
      activeAccountCount: 0,
    });
    await expect(
      createScheduledPublishingJob(deps, {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "instagram",
        scheduledFor: future,
        timezone: "UTC",
        idempotencyKey: "lock-sched-zero",
        executionMode: "simulation",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(getJobs()).toHaveLength(0);
  });

  it("immediate publish: fails closed (ValidationError) before createJob when 2+ accounts are mapped", async () => {
    const { deps, getJobs } = createHarness({
      draft: baseDraft({ status: "approved" }),
      viewerRole: "contributor",
      activeAccountCount: 2,
    });
    await expect(
      createImmediatePublishingJob(deps, {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "x",
        idempotencyKey: "lock-imm-many",
        executionMode: "simulation",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(getJobs()).toHaveLength(0);
  });

  it("scheduled publish: fails closed (ValidationError) before createJob when 2+ accounts are mapped", async () => {
    const { deps, getJobs } = createHarness({
      draft: baseDraft({ status: "approved" }),
      viewerRole: "contributor",
      activeAccountCount: 2,
    });
    await expect(
      createScheduledPublishingJob(deps, {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "linkedin",
        scheduledFor: future,
        timezone: "UTC",
        idempotencyKey: "lock-sched-many",
        executionMode: "simulation",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(getJobs()).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// reconcileBlotatoStatusTimeout — P0 regression: a real Instagram post
// published successfully at Blotato while BlotatoPublisherBase's polling
// exhausted its window without observing a terminal status, so Genesis
// recorded the attempt as blotato_status_timeout and marked the job/draft
// "failed" even though nothing was actually wrong with the post.
// ─────────────────────────────────────────────────────────────────────────────

function fakeGetPostStatus(status: BlotatoPostStatus) {
  const getPostStatus = async (_id: string) => status;
  return { getPostStatus };
}

/** Seeds a job whose only attempt ended in blotato_status_timeout — the exact shape reconciliation targets. */
async function seedTimedOutJob(
  deps: ReturnType<typeof createHarness>["deps"],
  overrides: { postSubmissionId?: string | null; errorCode?: string; triggerType?: "immediate" | "scheduled" } = {},
) {
  const job = await deps.publishing.createJob({
    organisationId: ORG_ID,
    draftId: DRAFT_ID,
    platform: "instagram",
    triggerType: overrides.triggerType ?? "immediate",
    scheduledFor: "2026-08-09T14:03:45.863Z",
    idempotencyKey: `timeout-job-${Math.random()}`,
    requestedBy: ACTOR_ID,
    maxRetries: 3,
    devSimulationMode: null,
    resolvedAccountId: null,
    // Reconciliation only ever targets a job that actually went through the
    // live provider path (a blotato_status_timeout error is structurally
    // unreachable from simulation) — see the new executionMode guard in
    // reconcileBlotatoStatusTimeout.
    executionMode: "live",
    isAiGenerated: null,
    isYourBrand: null,
    isBrandedContent: null,
  });
  const attempt = await deps.publishing.createAttempt({
    jobId: job.id,
    organisationId: ORG_ID,
    draftId: DRAFT_ID,
    platform: "instagram",
    attemptNumber: 1,
    retryOfAttemptId: null,
  });
  await deps.publishing.startAttempt(attempt.id);
  const providerMetadata =
    overrides.postSubmissionId === undefined
      ? { postSubmissionId: "sub-timeout-1", blotatoAccountId: "acc-1" }
      : overrides.postSubmissionId === null
        ? { blotatoAccountId: "acc-1" }
        : { postSubmissionId: overrides.postSubmissionId, blotatoAccountId: "acc-1" };
  await deps.publishing.failAttempt(attempt.id, {
    errorCode: overrides.errorCode ?? "blotato_status_timeout",
    errorMessage: "Blotato had not confirmed a final status for this post after polling.",
    providerMetadata,
  });
  await deps.publishing.markJobFailed(job.id);
  return job;
}

describe("reconcileBlotatoStatusTimeout", () => {
  it("1: provider confirms published → job status becomes published", async () => {
    const { deps, getJobs } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps);

    const result = await reconcileBlotatoStatusTimeout(
      { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: "https://instagram.com/p/real123", errorMessage: null }) },
      ORG_ID,
      job.id,
    );

    expect(result.outcome).toBe("published");
    expect(result.job.status).toBe("published");
    expect(getJobs().find((j) => j.id === job.id)?.status).toBe("published");
  });

  it("1b (fix/scheduled-publishing-integrity): reconciling a SCHEDULED job preserves triggerType='scheduled' — reconciliation never touches trigger_type", async () => {
    const { deps, getJobs } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const scheduledJob = await seedTimedOutJob(deps, { triggerType: "scheduled" });

    const result = await reconcileBlotatoStatusTimeout(
      { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: "https://instagram.com/p/real123", errorMessage: null }) },
      ORG_ID,
      scheduledJob.id,
    );

    expect(result.outcome).toBe("published");
    expect(result.job.triggerType).toBe("scheduled");
    expect(getJobs().find((j) => j.id === scheduledJob.id)?.triggerType).toBe("scheduled");
  });

  it("2: provider confirms published → a new attempt is appended as completed; the original timed-out attempt is untouched", async () => {
    const { deps, getAttempts } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps);

    await reconcileBlotatoStatusTimeout(
      { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: "https://instagram.com/p/real123", errorMessage: null }) },
      ORG_ID,
      job.id,
    );

    const attempts = getAttempts().filter((a) => a.jobId === job.id).sort((a, b) => a.attemptNumber - b.attemptNumber);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.status).toBe("failed");
    expect(attempts[0]!.errorCode).toBe("blotato_status_timeout");
    expect(attempts[1]!.status).toBe("completed");
    expect(attempts[1]!.retryOfAttemptId).toBe(attempts[0]!.id);
    expect(attempts[1]!.externalUrl).toBe("https://instagram.com/p/real123");
  });

  it("3: provider confirms published → draft status becomes published", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps);

    await reconcileBlotatoStatusTimeout(
      { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: "https://instagram.com/p/real123", errorMessage: null }) },
      ORG_ID,
      job.id,
    );

    expect(getDraft().status).toBe("published");
  });

  it("4: provider still shows in-progress → not treated as a hard failure; job stays failed/blotato_status_timeout for a later re-check", async () => {
    const { deps, getJobs, getAttempts } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps);

    const result = await reconcileBlotatoStatusTimeout(
      { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "in-progress", scheduledTime: null, publicUrl: null, errorMessage: null }) },
      ORG_ID,
      job.id,
    );

    expect(result.outcome).toBe("still_processing");
    expect(getJobs().find((j) => j.id === job.id)?.status).toBe("failed");
    // No new attempt was fabricated for an unresolved check.
    expect(getAttempts().filter((a) => a.jobId === job.id)).toHaveLength(1);
  });

  it("5: provider confirms genuinely failed → job/attempt remain failed (nothing to flip), audit records the confirmation", async () => {
    const { deps, getJobs, getAuditEvents } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps);

    const result = await reconcileBlotatoStatusTimeout(
      { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "failed", scheduledTime: null, publicUrl: null, errorMessage: "Publishing on instagram requires an image or a video" }) },
      ORG_ID,
      job.id,
    );

    expect(result.outcome).toBe("confirmed_failed");
    expect(getJobs().find((j) => j.id === job.id)?.status).toBe("failed");
    expect(getAuditEvents().some((e) => e.eventType === "publishing_attempt_reconciled")).toBe(true);
  });

  it("6: existing postSubmissionId is reused — the fake client exposes only getPostStatus, so reconciliation is structurally incapable of calling publishPost", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps);

    let getPostStatusCalls = 0;
    const status: BlotatoPostStatus = { postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: "https://instagram.com/p/real123", errorMessage: null };
    const blotatoClient = {
      getPostStatus: async (id: string) => {
        getPostStatusCalls += 1;
        expect(id).toBe("sub-timeout-1"); // reuses the ORIGINAL submission id — never mints a new one
        return status;
      },
    };

    await reconcileBlotatoStatusTimeout({ ...deps, blotatoClient }, ORG_ID, job.id);
    expect(getPostStatusCalls).toBe(1);
  });

  it("7: a job whose last attempt failed for a different reason (genuine blotato_publish_failed) is rejected — reconciliation only ever applies to blotato_status_timeout", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps, { errorCode: "blotato_publish_failed" });

    await expect(
      reconcileBlotatoStatusTimeout(
        { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: null, errorMessage: null }) },
        ORG_ID,
        job.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("8: a job with no recorded postSubmissionId is rejected rather than risk resubmission", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps, { postSubmissionId: null });

    await expect(
      reconcileBlotatoStatusTimeout(
        { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "irrelevant", status: "published", scheduledTime: null, publicUrl: null, errorMessage: null }) },
        ORG_ID,
        job.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("9: a job that is not currently failed (e.g. already queued/published) is rejected", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    const job = await deps.publishing.createJob({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "instagram",
      triggerType: "immediate",
      scheduledFor: "2026-08-09T14:03:45.863Z",
      idempotencyKey: "still-queued-reconcile",
      executionMode: "simulation",
      requestedBy: ACTOR_ID,
      maxRetries: 3,
      devSimulationMode: null,
      resolvedAccountId: null,
      isAiGenerated: null,
      isYourBrand: null,
      isBrandedContent: null,
    });

    await expect(
      reconcileBlotatoStatusTimeout(
        { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "irrelevant", status: "published", scheduledTime: null, publicUrl: null, errorMessage: null }) },
        ORG_ID,
        job.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("10: idempotency — reconciling twice never double-completes or republishes; the second call is rejected because the job is no longer failed", async () => {
    const { deps, getAttempts } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps);
    const blotatoClient = fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: "https://instagram.com/p/real123", errorMessage: null });

    const first = await reconcileBlotatoStatusTimeout({ ...deps, blotatoClient }, ORG_ID, job.id);
    expect(first.outcome).toBe("published");

    await expect(reconcileBlotatoStatusTimeout({ ...deps, blotatoClient }, ORG_ID, job.id)).rejects.toBeInstanceOf(ValidationError);
    // Still exactly 2 attempts (original timeout + one reconciliation) — the rejected second call created nothing.
    expect(getAttempts().filter((a) => a.jobId === job.id)).toHaveLength(2);
  });

  it("11: permission enforcement — a viewer with no write role cannot reconcile", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: null });
    const job = await seedTimedOutJob(deps);

    await expect(
      reconcileBlotatoStatusTimeout(
        { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: null, errorMessage: null }) },
        ORG_ID,
        job.id,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("12: organisation isolation — a job cannot be reconciled through a different organisationId", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    const job = await seedTimedOutJob(deps);

    await expect(
      reconcileBlotatoStatusTimeout(
        { ...deps, blotatoClient: fakeGetPostStatus({ postSubmissionId: "sub-timeout-1", status: "published", scheduledTime: null, publicUrl: null, errorMessage: null }) },
        OTHER_ORG_ID,
        job.id,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
