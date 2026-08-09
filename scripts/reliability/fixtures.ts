/**
 * Shared fixture builders for the reliability suite's in-memory checks —
 * the same shapes and defaults used throughout tests/*.test.ts, so a check
 * failing here means the exact same thing a failing vitest test would.
 */
import type { Actor } from "@/core/domain/entities/identity";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { PublishingAttempt, PublishingJob } from "@/core/domain/entities/publishing";
import type { MediaAsset } from "@/core/domain/entities/media";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import type { BlotatoClient, BlotatoPostStatus } from "@/core/application/ports/blotato-client-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";

export const ORG_A = "00000000-0000-4000-8000-0000000000a1";
export const ORG_B = "00000000-0000-4000-8000-0000000000b2";
export const DRAFT_ID = "00000000-0000-4000-8000-000000000d01";
export const AUTHOR_ID = "00000000-0000-4000-8000-00000000au01";
export const REVIEWER_ID = "00000000-0000-4000-8000-00000000rv01";
export const LEAD_ID = "00000000-0000-4000-8000-00000000ld01";

export function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: AUTHOR_ID,
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

export function profileRef(id: string, fullName: string) {
  return { id, fullName, email: `${id}@villiz.com` };
}

export function baseDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: DRAFT_ID,
    organisationId: ORG_A,
    title: "Reliability suite draft",
    contentType: "social_post",
    summary: null,
    body: "Body text used for the reliability suite.",
    status: "draft",
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
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    createdBy: profileRef(AUTHOR_ID, "Author One"),
    updatedBy: profileRef(AUTHOR_ID, "Author One"),
    priority: "medium",
    reviewDeadline: null,
    hashtags: [],
    ...overrides,
  };
}

let jobSeq = 0;
export function publishingJob(overrides: Partial<PublishingJob> = {}): PublishingJob {
  jobSeq += 1;
  return {
    id: `reliability-job-${jobSeq}`,
    organisationId: ORG_A,
    draftId: DRAFT_ID,
    platform: "linkedin",
    triggerType: "immediate",
    scheduledFor: "2026-08-01T10:00:00.000Z",
    status: "queued",
    idempotencyKey: `reliability-key-${jobSeq}`,
    requestedBy: AUTHOR_ID,
    requestedByProfile: profileRef(AUTHOR_ID, "Author One"),
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    claimedBy: null,
    nextAttemptAt: null,
    retryCount: 0,
    maxRetries: 3,
    completedAt: null,
    cancelledAt: null,
    devSimulationMode: null,
    resolvedAccountId: null,
    ...overrides,
  };
}

let attemptSeq = 0;
export function publishingAttempt(overrides: Partial<PublishingAttempt> = {}): PublishingAttempt {
  attemptSeq += 1;
  return {
    id: `reliability-attempt-${attemptSeq}`,
    jobId: `reliability-job-${attemptSeq}`,
    organisationId: ORG_A,
    draftId: DRAFT_ID,
    platform: "linkedin",
    attemptNumber: 1,
    status: "completed",
    queuedAt: "2026-08-01T10:00:00.000Z",
    startedAt: "2026-08-01T10:00:00.000Z",
    completedAt: "2026-08-01T10:00:01.000Z",
    failedAt: null,
    durationMs: 1000,
    externalPostId: "reliability-post-1",
    externalUrl: "https://mock.local/linkedin/reliability-post-1",
    errorCode: null,
    errorMessage: null,
    retryOfAttemptId: null,
    providerMetadata: {},
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

export function mediaAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "reliability-asset-1",
    organisationId: ORG_A,
    storagePath: `organisations/${ORG_A}/logo.png`,
    fileName: "logo.png",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    width: 200,
    height: 200,
    uploadedBy: null,
    createdAt: "2026-08-01T00:00:00Z",
    title: null,
    thumbnailPath: null,
    category: null,
    description: null,
    altText: null,
    tags: [],
    brand: null,
    duration: null,
    copyrightOwner: null,
    usageRights: null,
    expiresAt: null,
    isAiGenerated: false,
    isArchived: false,
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

export function blotatoStoredAccount(overrides: Partial<BlotatoAccount> = {}): BlotatoAccount {
  return {
    id: "reliability-blotato-account-1",
    platform: "linkedin",
    fullname: "Villiz Pixels",
    username: "villizpixels",
    organisationId: null,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

export function fakeBlotatoAccountRepository(overrides: Partial<BlotatoAccountRepository> = {}): BlotatoAccountRepository {
  return {
    upsertAccounts: async (accounts) => accounts.map((a) => blotatoStoredAccount(a)),
    listAccounts: async () => [],
    findMostRecentForPlatform: async () => null,
    findActiveForOrganisationAndPlatform: async () => [],
    listActiveForOrganisation: async () => [],
    assignToOrganisation: async () => blotatoStoredAccount(),
    removeFromOrganisation: async () => {},
    ...overrides,
  };
}

export function blotatoPublishedStatus(overrides: Partial<BlotatoPostStatus> = {}): BlotatoPostStatus {
  return {
    postSubmissionId: "reliability-submission-1",
    status: "published",
    scheduledTime: null,
    publicUrl: "https://blotato-cdn.example.com/post/reliability-submission-1",
    errorMessage: null,
    ...overrides,
  };
}

export function fakeBlotatoClient(overrides: Partial<BlotatoClient> = {}): BlotatoClient {
  return {
    listAccounts: async () => [],
    publishPost: async () => ({ postSubmissionId: "reliability-submission-1" }),
    getPostStatus: async (postSubmissionId) => blotatoPublishedStatus({ postSubmissionId }),
    ...overrides,
  };
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}

export function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
