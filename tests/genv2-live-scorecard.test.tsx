// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AnalyticsLiveView,
  buildWeeklyScorecard,
  type AnalyticsAttempt,
  type AnalyticsSnapshot,
} from "@/components/analytics/analytics-live-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const attempts: AnalyticsAttempt[] = [
  {
    id: "attempt-verified",
    organisationId: "org-1",
    organisationName: "Mervic",
    platform: "instagram",
    status: "completed",
    externalUrl: "https://instagram.com/p/verified",
    externalPostId: "post-1",
    createdAt: "2026-10-12T09:00:00.000Z",
    scheduledFor: "2026-10-12T08:30:00.000Z",
    captionPattern: "recommended",
  },
  {
    id: "attempt-pending",
    organisationId: "org-1",
    organisationName: "Mervic",
    platform: "tiktok",
    status: "completed",
    externalUrl: null,
    externalPostId: "post-2",
    createdAt: "2026-10-12T10:00:00.000Z",
    scheduledFor: "2026-10-12T09:30:00.000Z",
    captionPattern: "custom",
  },
];

const snapshots: AnalyticsSnapshot[] = [
  {
    publishingAttemptId: "attempt-verified",
    organisationId: "org-1",
    organisationName: "Mervic",
    platform: "instagram",
    observedAt: "2026-10-12T11:00:00.000Z",
    metrics: { views: 1200, likes: 48, followers: null },
  },
];

describe("Genesis v2 live analytics", () => {
  it("renders verified receipt links and keeps missing readback honestly pending", () => {
    render(
      <AnalyticsLiveView
        attempts={attempts}
        snapshots={snapshots}
        updatedAt="2026-10-12T12:00:00.000Z"
      />,
    );

    expect(screen.getByRole("link", { name: /open verified post/i })).toHaveAttribute(
      "href",
      "https://instagram.com/p/verified",
    );
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Pending readback")).toBeInTheDocument();
    expect(screen.queryByText("0 views")).not.toBeInTheDocument();
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
  });

  it("shows sparse provider data as pending rather than inventing engagement", () => {
    render(
      <AnalyticsLiveView attempts={attempts.slice(1)} snapshots={[]} updatedAt="2026-10-12T12:00:00.000Z" />,
    );

    expect(screen.getByText("Metrics awaiting first sync")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("rolls the week up by organisation, platform, caption pattern and UTC slot", () => {
    const rows = buildWeeklyScorecard(attempts, snapshots, new Date("2026-10-12T12:00:00.000Z"));

    expect(rows).toEqual([
      expect.objectContaining({
        organisationName: "Mervic",
        platform: "instagram",
        captionPattern: "recommended",
        slot: "08:00 UTC",
        posts: 1,
        views: 1200,
        likes: 48,
      }),
      expect.objectContaining({
        organisationName: "Mervic",
        platform: "tiktok",
        captionPattern: "custom",
        slot: "09:00 UTC",
        posts: 1,
        views: null,
        likes: null,
      }),
    ]);
  });
});
