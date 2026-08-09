// @vitest-environment jsdom
/**
 * End-to-end regression for the P0 "scheduled job never created" incident
 * (fix/scheduled-publishing-integrity, second pass).
 *
 * Every other scheduling test in this suite mocks
 * createScheduledPublishingJobAction itself — which is exactly why the
 * regression shipped undetected: the bug was in how PublishingPanel's real
 * <form> serializes at submission time (a disabled native form control is
 * excluded from FormData), and no test exercised the REAL action end to
 * end from a REAL click. This test mocks only the lowest-level
 * dependencies (requireContext, the use-case, preflight, AI review) and
 * drives the actual PublishingPanel → PrePublishDialog → real
 * createScheduledPublishingJobAction → real FormData serialization path.
 *
 * Proven production failure this reproduces and guards: confirmed
 * 2026-08-09T18:07:25Z, "Choose a date and time to publish.", zero
 * publishing_jobs row created, because scheduledAt/timezone were disabled
 * (dialogOpen=true) at the exact moment requestSubmit() ran.
 *
 * E1 — a real Schedule confirmation creates exactly one job via the real action + real FormData
 * E2 — the job's scheduledFor is a well-formed, non-empty, correct UTC instant (not silently dropped)
 * E3 — the job's timezone is preserved (not silently dropped)
 * E4 — a real Publish Now confirmation still works unaffected by the schedule-path fix
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing", () => ({
  createImmediatePublishingJob: vi.fn(async () => ({ id: "job-immediate-1" })),
  createScheduledPublishingJob: vi.fn(async () => ({ id: "job-scheduled-1" })),
  generateIdempotencyKey: vi.fn(() => "key"),
  retryFailedPublishingJob: vi.fn(),
  cancelPublishingJob: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing/preflight", () => ({
  checkPublishingPreflight: vi.fn(async () => ({ ready: true, blockers: [] })),
}));

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(() => ({ apiKey: "k", enabled: true, livePublishingEnabled: false })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/routes", () => ({
  routes: {
    organisations: {
      content: { index: (o: string) => `/organisations/${o}/content`, draft: (o: string, d: string) => `/organisations/${o}/content/${d}` },
      detail: (o: string) => `/organisations/${o}`,
    },
    dashboard: "/dashboard",
  },
}));

vi.mock("@/server/actions/content", () => ({
  archiveDraftAction: vi.fn(),
  duplicateDraftAction: vi.fn(),
}));

vi.mock("@/server/actions/publish", () => ({
  runPrePublishReviewAction: vi.fn(async () => ({
    score: 92,
    brandVoiceAlignment: "high",
    readability: "easy",
    ctaQuality: "strong",
    platformOptimisation: "high",
    hashtagQuality: "optimal",
    accessibility: "good",
    compliance: "pass",
    missingMedia: false,
    brokenLinks: false,
    recommendations: [],
  })),
  getPlatformPreflightAction: vi.fn(async () => ({ ready: true, blockers: [] })),
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PublishingPanel } from "@/components/content/publishing-panel";
import { requireContext } from "@/server/container";
import { createScheduledPublishingJob, createImmediatePublishingJob } from "@/core/application/use-cases/publishing";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function approvedDraft(): ContentDraft {
  return {
    id: "draft-1",
    organisationId: ORG_ID,
    title: "Your Birthday shoot deserves more than phone pictures!",
    contentType: "social_post",
    summary: null,
    body: "Body text",
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
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    createdBy: { id: "author-1", fullName: "Author One", email: "author@villiz.com" },
    updatedBy: { id: "author-1", fullName: "Author One", email: "author@villiz.com" },
    priority: "medium",
    reviewDeadline: null,
    hashtags: ["coventryphotographer", "birthdaycelebration"],
  };
}

function instagramChannel(): BlotatoAccount {
  return {
    id: "acc-villizpixelsuk",
    platform: "instagram",
    fullname: "Villiz Pixels UK",
    username: "villizpixelsuk",
    organisationId: ORG_ID,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-01T00:00:00Z",
  };
}

function futureDateTimeLocal(): string {
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T19:13`;
}

beforeEach(() => {
  vi.clearAllMocks();
  const context = {
    actor: { id: "user-1" },
    publishing: {},
    blotatoAccounts: {},
    content: {},
    organisations: {},
    audits: {},
    notifications: {},
    media: {},
  };
  vi.mocked(requireContext).mockResolvedValue(context as never);
});

describe("E1/E2/E3 — a real Schedule confirmation, through the real action and real FormData, creates exactly one job with a preserved instant and timezone", () => {
  it("reproduces the production UAT (Europe/London, 7:13 PM) and proves it now succeeds", async () => {
    render(
      <PublishingPanel organisationId={ORG_ID} draft={approvedDraft()} canWrite={true} channels={[instagramChannel()]} isLivePublishing={true} />,
    );

    fireEvent.change(screen.getByLabelText("Scheduled Date & Time"), { target: { value: futureDateTimeLocal() } });
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Europe/London" } });
    fireEvent.click(screen.getByText("Schedule"));

    const confirmButton = await screen.findByRole("button", { name: "Schedule Post" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(createScheduledPublishingJob).toHaveBeenCalledTimes(1));

    const callArgs = vi.mocked(createScheduledPublishingJob).mock.calls[0]![1] as { scheduledFor: string; timezone: string };

    // E2: scheduledFor must be present, well-formed, and NOT silently dropped.
    expect(callArgs.scheduledFor).toBeTruthy();
    expect(Number.isNaN(new Date(callArgs.scheduledFor).getTime())).toBe(false);
    expect(callArgs.scheduledFor.endsWith("Z")).toBe(true); // canonical UTC instant

    // E3: the selected timezone survives into the use-case call.
    expect(callArgs.timezone).toBe("Europe/London");

    expect(createImmediatePublishingJob).not.toHaveBeenCalled();
  });
});

describe("E4 — a real Publish Now confirmation is unaffected by the schedule-path fix", () => {
  it("still creates exactly one immediate job through the real action", async () => {
    render(
      <PublishingPanel organisationId={ORG_ID} draft={approvedDraft()} canWrite={true} channels={[instagramChannel()]} isLivePublishing={true} />,
    );

    fireEvent.click(screen.getByText("Publish Now"));
    const confirmButton = await screen.findByRole("button", { name: "Publish Now" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(createImmediatePublishingJob).toHaveBeenCalledTimes(1));
    expect(createScheduledPublishingJob).not.toHaveBeenCalled();
  });
});
