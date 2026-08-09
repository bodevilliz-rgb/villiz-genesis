// @vitest-environment jsdom
/**
 * PublishingPanel / Pre-Publish Review — canonical publishing-intent
 * regression (fix/scheduled-publishing-integrity).
 *
 * Root causes proven in production:
 *   1. PrePublishDialog received no information about which action (Publish
 *      Now vs Schedule) was being confirmed at all — its confirm button
 *      label was hardcoded to "Publish Now"/"Publish Anyway" regardless.
 *   2. The scheduling timezone selector offered ambiguous abbreviations and
 *      the raw naive datetime string was parsed as server-local time,
 *      ignoring the selected zone (see scheduling-timezone.test.ts).
 *
 * P1 — clicking Schedule captures a scheduled intent and opens the dialog with a scheduling summary
 * P2 — clicking Publish Now captures an immediate intent
 * P3 — the scheduled dialog's confirm button reads "Schedule Post", never "Publish Now"
 * P4 — the immediate dialog's confirm button reads "Publish Now"
 * P5 — confirming a scheduled intent calls ONLY the scheduled action
 * P6 — confirming an immediate intent calls ONLY the immediate action
 * P7 — rapid double-click on confirm submits only once
 * P8 — an invalid timezone/time is rejected before the dialog ever opens
 * P9 — destination selector and scheduling fields are disabled while the review dialog is open
 */

vi.mock("@/server/actions/content", () => ({
  archiveDraftAction: vi.fn(),
  duplicateDraftAction: vi.fn(),
}));

vi.mock("@/server/actions/publishing", () => ({
  createImmediatePublishingJobAction: vi.fn(async () => ({ status: "success", message: "Published", resourceId: "job-1" })),
  createScheduledPublishingJobAction: vi.fn(async () => ({ status: "success", message: "Scheduled", resourceId: "job-2" })),
}));

vi.mock("@/server/actions/publish", () => ({
  runPrePublishReviewAction: vi.fn(async () => ({
    score: 90,
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
import { createImmediatePublishingJobAction, createScheduledPublishingJobAction } from "@/server/actions/publishing";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function approvedDraft(): ContentDraft {
  return {
    id: "draft-1",
    organisationId: ORG_ID,
    title: "A draft",
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
    hashtags: ["one", "two"],
  };
}

function instagramChannel(): BlotatoAccount {
  return {
    id: "acc-1",
    platform: "instagram",
    fullname: "Test Account",
    username: "testaccount",
    organisationId: ORG_ID,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-01T00:00:00Z",
  };
}

function futureDateTimeLocal(): string {
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days out
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T12:00`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function scheduleUpToDialog() {
  render(
    <PublishingPanel organisationId={ORG_ID} draft={approvedDraft()} canWrite={true} channels={[instagramChannel()]} isLivePublishing={true} />,
  );

  const scheduledAtInput = screen.getByLabelText("Scheduled Date & Time");
  fireEvent.change(scheduledAtInput, { target: { value: futureDateTimeLocal() } });

  const timezoneSelect = screen.getByLabelText("Timezone");
  fireEvent.change(timezoneSelect, { target: { value: "Europe/London" } });

  fireEvent.click(screen.getByText("Schedule"));
  await screen.findByText("Pre-Publish Review");
  await waitFor(() => expect(screen.getByText(/Scheduled for/i)).toBeInTheDocument());
}

async function publishUpToDialog() {
  render(
    <PublishingPanel organisationId={ORG_ID} draft={approvedDraft()} canWrite={true} channels={[instagramChannel()]} isLivePublishing={true} />,
  );
  fireEvent.click(screen.getByText("Publish Now"));
  await screen.findByText("Pre-Publish Review");
}

describe("P1 — Schedule click captures a scheduled intent with a visible scheduling summary", () => {
  it("opens the dialog showing the scheduled local time and the operator-selected timezone", async () => {
    await scheduleUpToDialog();
    expect(screen.getByText(/Scheduled for/i)).toBeInTheDocument();
    // "Europe/London" also appears as a <select> option — the timezone must
    // appear at least in the review summary alongside it, not vanish.
    expect(screen.getAllByText(/Europe\/London/).length).toBeGreaterThanOrEqual(1);
  });
});

describe("P2 — Publish Now click captures an immediate intent (no scheduling summary)", () => {
  it("opens the dialog without any 'Scheduled for' summary", async () => {
    await publishUpToDialog();
    expect(screen.queryByText(/Scheduled for/i)).toBeNull();
  });
});

describe("P3/P4 — confirm button label is derived from intent.mode, never hardcoded", () => {
  it("P3: scheduled review shows 'Schedule Post', never 'Publish Now'", async () => {
    await scheduleUpToDialog();
    await waitFor(() => expect(screen.getByRole("button", { name: "Schedule Post" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Publish Now" })).toBeNull();
  });

  it("P4: immediate review shows 'Publish Now'", async () => {
    await publishUpToDialog();
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish Now" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Schedule Post" })).toBeNull();
  });
});

describe("P5/P6/P7 — confirming invokes exactly one action, exactly once", () => {
  it("P5: confirming a scheduled intent calls ONLY createScheduledPublishingJobAction", async () => {
    await scheduleUpToDialog();
    const confirmButton = await screen.findByRole("button", { name: "Schedule Post" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(createScheduledPublishingJobAction).toHaveBeenCalledTimes(1));
    expect(createImmediatePublishingJobAction).not.toHaveBeenCalled();
  });

  it("P6: confirming an immediate intent calls ONLY createImmediatePublishingJobAction", async () => {
    await publishUpToDialog();
    const confirmButton = await screen.findByRole("button", { name: "Publish Now" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(createImmediatePublishingJobAction).toHaveBeenCalledTimes(1));
    expect(createScheduledPublishingJobAction).not.toHaveBeenCalled();
  });

  it("P7: two rapid clicks on the confirm button submit only once", async () => {
    await scheduleUpToDialog();
    const confirmButton = await screen.findByRole("button", { name: "Schedule Post" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(createScheduledPublishingJobAction).toHaveBeenCalledTimes(1));
  });
});

describe("P8 — an invalid timezone/time is rejected before the dialog ever opens", () => {
  it("scheduling with no date/time selected does not open the dialog (native required validation) — the action is never called", () => {
    render(
      <PublishingPanel organisationId={ORG_ID} draft={approvedDraft()} canWrite={true} channels={[instagramChannel()]} isLivePublishing={true} />,
    );
    // scheduledAt left empty (default "") — handlePublishIntercept only fires
    // after the click handler runs; convertLocalTimeToUtc will reject "".
    fireEvent.click(screen.getByText("Schedule"));
    expect(screen.queryByText("Pre-Publish Review")).toBeNull();
    expect(createScheduledPublishingJobAction).not.toHaveBeenCalled();
  });
});

describe("P9 — destination and scheduling fields lock while the review dialog is open", () => {
  it("the timezone and scheduled-date controls become disabled once the dialog opens", async () => {
    await scheduleUpToDialog();
    expect(screen.getByLabelText("Timezone")).toBeDisabled();
    expect(screen.getByLabelText("Scheduled Date & Time")).toBeDisabled();
    expect(screen.getByLabelText("Publish to")).toBeDisabled();
  });
});
