// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EngagementIntelligencePanel } from "@/components/content/engagement-intelligence-panel";
import type { EngagementRecommendation } from "@/core/domain/entities/engagement";

vi.mock("@/server/actions/awo", () => ({
  generateEngagementRecommendationAction: vi.fn(),
}));

const recommendation: EngagementRecommendation = {
  id: "rec-1",
  organisationId: "org-1",
  draftId: "draft-1",
  draftVersion: 3,
  platform: "instagram",
  objectiveType: "bookings",
  objective: "Increase booking enquiries",
  dataBasis: "brand_only",
  recommendedCaption: "A portrait that feels like you. Book your session today.",
  alternativeCaptions: ["Your story belongs in the frame."],
  hook: "A portrait that feels like you.",
  cta: "Book your session today.",
  hashtags: {
    brand: ["#VillizPixels"],
    local: ["#CoventryPhotographer"],
    service: ["#PortraitPhotography"],
    audience: [],
  },
  rationale: "The identity-led hook supports the booking objective.",
  predictedStrengths: ["Clear hook", "Direct CTA"],
  limitations: ["Brand-informed recommendation only."],
  creativeGuidance: {
    mediaBasis: "none",
    visualHook: "Lead with the portrait.",
    formatRecommendation: "Use a portrait carousel.",
    shareTrigger: "Invite someone planning a portrait.",
    saveTrigger: "Save the preparation tips.",
    accessibilityNote: "Add descriptive alt text.",
  },
  confidence: 70,
  performanceConfidence: null,
  performanceSummary: { sampleSize: 0, minimumSampleSize: 10, directionalScore: null, label: "insufficient_data", championVariant: null, challengerVariant: null, variantScores: {} },
  evidence: [
    {
      sourceType: "membrain_entry",
      sourceId: "entry-1",
      title: "Brand voice",
      categoryKey: "brand_voice",
      version: 2,
    },
  ],
  createdBy: "actor-1",
  createdAt: "2026-08-10T12:00:00Z",
};

describe("EngagementIntelligencePanel", () => {
  it("shows the recommendation, confidence, hashtags and evidence basis", () => {
    render(
      <EngagementIntelligencePanel
        organisationId="org-1"
        draftId="draft-1"
        currentDraftVersion={3}
        initialPlatform="instagram"
        initialRecommendation={recommendation}
        canWrite={true}
      />,
    );

    expect(screen.getByText("Brand-informed")).toBeInTheDocument();
    expect(screen.getByText("Brand fit 70%")).toBeInTheDocument();
    expect(screen.getByText(recommendation.recommendedCaption)).toBeInTheDocument();
    expect(screen.getByText("#VillizPixels")).toBeInTheDocument();
    expect(screen.getByText(/Evidence: 1 source record/)).toBeInTheDocument();
  });

  it("marks a recommendation outdated when the draft version has moved on", () => {
    render(
      <EngagementIntelligencePanel
        organisationId="org-1"
        draftId="draft-1"
        currentDraftVersion={4}
        initialPlatform="instagram"
        initialRecommendation={recommendation}
        canWrite={true}
      />,
    );

    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(screen.getByText(/used draft v3; the current draft is v4/i)).toBeInTheDocument();
  });

  it("keeps generation unavailable to a read-only reviewer", () => {
    render(
      <EngagementIntelligencePanel
        organisationId="org-1"
        draftId="draft-1"
        currentDraftVersion={3}
        initialPlatform="instagram"
        initialRecommendation={null}
        canWrite={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Generate recommendation" })).toBeDisabled();
    expect(screen.getByText(/Contributor or Lead access is required/)).toBeInTheDocument();
  });
});
