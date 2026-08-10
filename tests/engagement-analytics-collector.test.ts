import { describe, expect, it, vi } from "vitest";
import { collectEngagementAnalytics } from "@/core/application/use-cases/engagement/collector";
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
  providerMetadata: { publishedPayloadFingerprint: engagementPayloadFingerprint("Chosen", []) }, createdAt: "2026-08-01T00:00:00Z",
};

describe("engagement analytics collector", () => {
  it("normalises and idempotently attributes provider metrics to a pre-publication selection", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ id: "metric-1", createdAt: input.observedAt, ...input }));
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

    expect(result).toEqual({ checked: 1, recorded: 1, skipped: 0, failed: 0 });
    expect(engagement.findLatestFeedback).toHaveBeenCalledWith("org-1", "draft-1", attempt.completedAt);
    expect(createMetricSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: "rec-1", feedbackEventId: "feedback-1", selectedVariant: "alternative_1", objectiveType: "bookings",
      providerSnapshotKey: expect.stringMatching(/^blotato:post-1:2026-08-02T00:00:00Z:/),
      metrics: expect.objectContaining({ views: 1000, shares: 10 }),
    }));
  });

  it("keeps baseline metrics unattributed when no recommendation was selected", async () => {
    const createMetricSnapshot = vi.fn(async (input) => ({ id: "metric-1", createdAt: input.observedAt, ...input }));
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
    const createMetricSnapshot = vi.fn(async (input) => ({ id: "metric", createdAt: input.observedAt, ...input }));
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
    const createMetricSnapshot = vi.fn(async (input) => ({ id: "metric", createdAt: input.observedAt, ...input }));
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
    const createMetricSnapshot = vi.fn(async (input) => ({ id: "metric", createdAt: input.observedAt, ...input }));
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
});
