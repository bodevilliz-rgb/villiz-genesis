import { describe, expect, it, vi } from "vitest";
import { collectEngagementAnalytics, measurementWindow } from "@/core/application/use-cases/engagement/collector";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { PublishingRepository } from "@/core/application/ports/publishing-port";
import type { PublishingAttempt } from "@/core/domain/entities/publishing";
import { engagementPayloadFingerprint } from "@/core/application/use-cases/engagement/fingerprint";

const attempt: PublishingAttempt = {
  id: "attempt-1", jobId: "job-1", organisationId: "org-1", draftId: "draft-1",
  platform: "instagram", attemptNumber: 1, status: "completed", queuedAt: "2026-08-01T00:00:00Z",
  startedAt: "2026-08-01T00:00:01Z", completedAt: "2026-08-01T00:00:02Z", failedAt: null,
  durationMs: 1000, externalPostId: "post-1", externalUrl: "https://instagram.com/p/1",
  errorCode: null, errorMessage: null, retryOfAttemptId: null,
  providerMetadata: { blotatoAccountId: "account-1", publishedPayloadFingerprint: engagementPayloadFingerprint("Chosen", []) }, createdAt: "2026-08-01T00:00:00Z",
};

describe("engagement analytics collector", () => {
  it("assigns deterministic 24h, 72h and 7d post-age checkpoints", () => {
    const completed = "2026-08-01T00:00:00Z";
    expect(measurementWindow(completed, "2026-08-01T23:59:00Z", "2026-08-02T00:00:00Z")).toBe("under_24h");
    expect(measurementWindow(completed, "2026-08-02T00:00:00Z", "2026-08-02T00:00:00Z")).toBe("24h");
    expect(measurementWindow(completed, "2026-08-04T00:00:00Z", "2026-08-04T00:00:00Z")).toBe("72h");
    expect(measurementWindow(completed, "2026-08-08T00:00:00Z", "2026-08-08T00:00:00Z")).toBe("7d");
  });
  it("normalises and idempotently attributes provider metrics to a pre-publication selection", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric-1", createdAt: input.observedAt, ...input }, created: true }));
    const engagement = {
      findLatestFeedback: vi.fn(async (_org, _draft, before) => ({
        id: "feedback-1", organisationId: "org-1", draftId: "draft-1", recommendationId: "rec-1",
        action: "selected", variant: "alternative_1", captionSnapshot: "Chosen", hashtagSnapshot: [],
        reason: null, createdBy: "actor", createdAt: "2026-07-31T23:00:00Z", before,
      })),
      findById: vi.fn(async () => ({ id: "rec-1", objectiveType: "bookings", platform: "instagram" })),
      createMetricSnapshot,
    } as unknown as EngagementRepository;
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({
      postId: "post-1", latest: { capturedAt: "2026-08-02T00:00:00Z", metrics: { viewCount: "1000", shareCount: 10 } }, history: [],
    })) } as unknown as BlotatoClient;

    const result = await collectEngagementAnalytics({ publishing, engagement, blotatoClient });

    expect(result).toEqual({ checked: 1, recorded: 1, alreadyRecorded: 0, skipped: 0, failed: 0 });
    expect(publishing.listAttemptsForAnalytics).toHaveBeenCalledWith(undefined, expect.objectContaining({
      status: "completed", requireExternalPostId: true, newestFirst: true,
    }));
    expect(engagement.findLatestFeedback).toHaveBeenCalledWith("org-1", "draft-1", attempt.completedAt);
    expect(createMetricSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: "rec-1", feedbackEventId: "feedback-1", selectedVariant: "alternative_1", objectiveType: "bookings",
      providerAccountId: "account-1",
      providerSnapshotKey: expect.stringMatching(/^blotato:account-1:post-1:2026-08-02T00:00:00Z:/),
      metrics: expect.objectContaining({ views: 1000, shares: 10 }),
    }));
  });

  it("normalises Blotato's actual plural Count fields without treating provider data as commercial outcomes", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric", createdAt: input.observedAt, ...input }, created: true }));
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({ postId: "post-1", history: [], latest: { capturedAt: null, metrics: {
      viewsCount: "128", reachCount: "111", likesCount: "1", commentsCount: "0", sharesCount: "0", savesCount: "0",
      profileVisitsCount: "3", viewTimeMsSum: "283695", leads: "99", conversions: "88",
    } } })) } as unknown as BlotatoClient;
    await collectEngagementAnalytics({ publishing, engagement: { findLatestFeedback: vi.fn(async () => null), createMetricSnapshot } as unknown as EngagementRepository, blotatoClient });
    expect(createMetricSnapshot).toHaveBeenCalledWith(expect.objectContaining({ metrics: expect.objectContaining({
      views: 128, reach: 111, likes: 1, comments: 0, shares: 0, saves: 0, profileVisits: 3,
      watchTimeMs: 283695, enquiries: null, bookings: null,
    }) }));
  });

  it("keeps baseline metrics unattributed when no recommendation was selected", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric-1", createdAt: input.observedAt, ...input }, created: true }));
    const engagement = {
      findLatestFeedback: vi.fn(async () => null), createMetricSnapshot,
    } as unknown as EngagementRepository;
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({
      postId: "post-1", latest: { capturedAt: null, metrics: { views: 100 } }, history: [],
    })) } as unknown as BlotatoClient;

    await collectEngagementAnalytics({ publishing, engagement, blotatoClient });
    expect(createMetricSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: null, feedbackEventId: null, selectedVariant: null, objectiveType: "engagement",
    }));
  });

  it("refuses attribution when the recorded choice does not match the published payload", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric", createdAt: input.observedAt, ...input }, created: true }));
    const engagement = {
      findLatestFeedback: vi.fn(async () => ({
        id: "feedback-wrong", recommendationId: "rec-wrong", action: "selected", variant: "recommended",
        captionSnapshot: "A different caption", hashtagSnapshot: [],
      })),
      findById: vi.fn(async () => ({ id: "rec-wrong", objectiveType: "bookings" })),
      createMetricSnapshot,
    } as unknown as EngagementRepository;
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({
      postId: "post-1", latest: { capturedAt: null, metrics: { views: 100 } }, history: [],
    })) } as unknown as BlotatoClient;
    await collectEngagementAnalytics({ publishing, engagement, blotatoClient });
    expect(engagement.findById).not.toHaveBeenCalled();
    expect(createMetricSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: null, feedbackEventId: null, selectedVariant: null,
    }));
  });

  it("refuses cross-platform attribution even when caption and hashtags are identical", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric", createdAt: input.observedAt, ...input }, created: true }));
    const engagement = {
      findLatestFeedback: vi.fn(async () => ({
        id: "feedback-tiktok", recommendationId: "rec-tiktok", action: "selected", variant: "recommended",
        captionSnapshot: "Chosen", hashtagSnapshot: [],
      })),
      findById: vi.fn(async () => ({ id: "rec-tiktok", objectiveType: "engagement", platform: "tiktok" })),
      createMetricSnapshot,
    } as unknown as EngagementRepository;
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({
      postId: "post-1", latest: { capturedAt: null, metrics: { views: 100 } }, history: [],
    })) } as unknown as BlotatoClient;
    await collectEngagementAnalytics({ publishing, engagement, blotatoClient });
    expect(createMetricSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: null, feedbackEventId: null, selectedVariant: null,
    }));
  });

  it("finds an earlier matching same-platform choice instead of losing attribution to a later cross-platform choice", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric", createdAt: input.observedAt, ...input }, created: true }));
    const engagement = {
      listFeedbackForDraft: vi.fn(async () => [
        { id: "feedback-tiktok", recommendationId: "rec-tiktok", action: "selected", variant: "recommended", captionSnapshot: "Chosen", hashtagSnapshot: [] },
        { id: "feedback-instagram", recommendationId: "rec-instagram", action: "selected", variant: "alternative_1", captionSnapshot: "Chosen", hashtagSnapshot: [] },
      ]),
      findById: vi.fn(async (_org, id) => id === "rec-tiktok"
        ? { id, objectiveType: "engagement", platform: "tiktok" }
        : { id, objectiveType: "bookings", platform: "instagram" }),
      createMetricSnapshot,
    } as unknown as EngagementRepository;
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({ postId: "post-1", history: [],
      latest: { capturedAt: null, metrics: { views: 100 } },
    })) } as unknown as BlotatoClient;
    await collectEngagementAnalytics({ publishing, engagement, blotatoClient });
    expect(createMetricSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: "rec-instagram", feedbackEventId: "feedback-instagram",
      selectedVariant: "alternative_1", objectiveType: "bookings",
    }));
  });

  it("excludes simulated attempts before any provider call", async () => {
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [{
      ...attempt, providerMetadata: { simulated: true }, externalPostId: "mock-post",
    }]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn() } as unknown as BlotatoClient;
    const result = await collectEngagementAnalytics({ publishing, engagement: {} as EngagementRepository, blotatoClient });
    expect(result.checked).toBe(0);
    expect(blotatoClient.getPostAnalytics).not.toHaveBeenCalled();
  });

  it("records both history and a distinct latest provider snapshot", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric", createdAt: input.observedAt, ...input }, created: true }));
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({ postId: "post-1",
      history: [{ capturedAt: "2026-08-01T00:00:00Z", metrics: { views: 50 } }],
      latest: { capturedAt: "2026-08-02T00:00:00Z", metrics: { views: 100 } },
    })) } as unknown as BlotatoClient;
    const result = await collectEngagementAnalytics({ publishing, engagement: {
      findLatestFeedback: vi.fn(async () => null), createMetricSnapshot,
    } as unknown as EngagementRepository, blotatoClient });
    expect(result.recorded).toBe(2);
    expect(createMetricSnapshot).toHaveBeenCalledTimes(2);
  });

  it("reports an existing idempotent snapshot separately from a new insert", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric", createdAt: input.observedAt, ...input }, created: false }));
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({ postId: "post-1", history: [],
      latest: { capturedAt: "2026-08-02T00:00:00Z", metrics: { views: 100 } },
    })) } as unknown as BlotatoClient;
    const result = await collectEngagementAnalytics({ publishing, engagement: {
      findLatestFeedback: vi.fn(async () => null), createMetricSnapshot,
    } as unknown as EngagementRepository, blotatoClient });
    expect(result).toEqual({ checked: 1, recorded: 0, alreadyRecorded: 1, skipped: 0, failed: 0 });
  });

  it("caps provider history and rejects invalid future timestamps", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ snapshot: { id: "metric", createdAt: input.observedAt, ...input }, created: true }));
    const publishing = { listAttemptsForAnalytics: vi.fn(async () => [attempt]) } as unknown as PublishingRepository;
    const history = Array.from({ length: 30 }, (_, index) => ({
      capturedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`, metrics: { views: index + 1 },
    }));
    history.push({ capturedAt: "2999-01-01T00:00:00Z", metrics: { views: 999 } });
    const blotatoClient = { getPostAnalytics: vi.fn(async () => ({ postId: "post-1", history,
      latest: { capturedAt: "2026-08-01T00:00:00Z", metrics: { views: 31 } },
    })) } as unknown as BlotatoClient;
    const result = await collectEngagementAnalytics({ publishing, engagement: {
      findLatestFeedback: vi.fn(async () => null), createMetricSnapshot,
    } as unknown as EngagementRepository, blotatoClient });
    expect(result.recorded).toBe(20);
    expect(createMetricSnapshot).toHaveBeenCalledTimes(20);
    expect(createMetricSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({ providerCapturedAt: "2999-01-01T00:00:00Z" }));
  });
});
