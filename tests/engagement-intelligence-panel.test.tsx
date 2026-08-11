// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EngagementIntelligencePanel } from "@/components/content/engagement-intelligence-panel";
import type { EngagementRecommendation } from "@/core/domain/entities/engagement";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/server/actions/awo", () => ({
  generateEngagementRecommendationAction: vi.fn(),
  applyEngagementRecommendationAction: vi.fn(),
  recordEngagementCommercialOutcomeAction: vi.fn(),
  recordEngagementFeedbackAction: vi.fn(),
  refreshEngagementAnalyticsAction: vi.fn(),
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
    linkedinPersonalProfile: null,
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

const learningOverview = {
  platform: "instagram" as const,
  objectiveType: "bookings" as const,
  accountScope: "account_scoped" as const,
  providerAccountId: "account-1",
  latestFeedback: {
    id: "feedback-1", organisationId: "org-1", draftId: "draft-1", recommendationId: "rec-1",
    action: "selected" as const, variant: "recommended" as const,
    captionSnapshot: recommendation.recommendedCaption, hashtagSnapshot: ["#VillizPixels"],
    reason: null, createdBy: "actor-1", createdAt: "2026-08-10T12:05:00Z",
    appliedDraftVersion: null,
  },
  latestDraftMetric: null,
  latestCommercialOutcome: null,
  lastAnalyticsSyncAt: null,
  nextScheduledCollectionAt: "2026-08-11T04:15:00Z",
  checkpoints: { hours24: false, hours72: false, days7: false },
  exclusions: [],
  performanceSummary: { ...recommendation.performanceSummary, performanceConfidence: null },
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
        initialLearningOverview={learningOverview}
        initialDraftBody="Existing caption"
        initialDraftHashtags={[]}
        draftLocked={false}
        canWrite={true}
      />,
    );

    expect(screen.getByText("Brand-informed")).toBeInTheDocument();
    expect(screen.getByText("Brand fit 70%")).toBeInTheDocument();
    expect(screen.getByText(recommendation.recommendedCaption)).toBeInTheDocument();
    expect(screen.getByText("#VillizPixels")).toBeInTheDocument();
    expect(screen.getByText(/Evidence: 1 source record/)).toBeInTheDocument();
    expect(screen.getByText("Recorded, not current")).toBeInTheDocument();
  });

  it("marks a recommendation outdated when the draft version has moved on", () => {
    render(
      <EngagementIntelligencePanel
        organisationId="org-1"
        draftId="draft-1"
        currentDraftVersion={4}
        initialPlatform="instagram"
        initialRecommendation={recommendation}
        initialLearningOverview={learningOverview}
        initialDraftBody="Existing caption"
        initialDraftHashtags={[]}
        draftLocked={false}
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
        initialLearningOverview={{ ...learningOverview, latestFeedback: null }}
        initialDraftBody="Existing caption"
        initialDraftHashtags={[]}
        draftLocked={false}
        canWrite={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Generate recommendation" })).toBeDisabled();
    expect(screen.getByText(/Contributor or Lead access is required/)).toBeInTheDocument();
  });

  it("shows the personal-profile LinkedIn readiness rubric without promising reach", () => {
    const linkedinRecommendation: EngagementRecommendation = {
      ...recommendation,
      platform: "linkedin",
      creativeGuidance: {
        ...recommendation.creativeGuidance,
        linkedinPersonalProfile: {
          accountType: "personal_profile",
          postArchetype: "lesson_learned",
          readinessScore: 87,
          audiencePromise: "A practical lesson for portrait clients.",
          credibilityAnchor: "Studio experience recorded in MemBrain.",
          conversationPrompt: "What helps you feel prepared?",
          dimensions: { hook: 4, singleIdea: 5, personalVoice: 5, credibility: 3, scanability: 4, conversationCta: 5 },
          improvementActions: ["Add one supported concrete example."],
          credibilityEvidenceIds: ["entry-1"],
          auditStatus: "passed",
          auditAttempts: 1,
        },
      },
    };
    render(
      <EngagementIntelligencePanel
        organisationId="org-1" draftId="draft-1" currentDraftVersion={3}
        initialPlatform="linkedin" initialRecommendation={linkedinRecommendation}
        initialLearningOverview={{ ...learningOverview, platform: "linkedin" }}
        initialDraftBody="Existing caption" initialDraftHashtags={[]}
        draftLocked={false} canWrite={true}
      />,
    );
    expect(screen.getByText("LinkedIn personal-profile check · 87/100")).toBeInTheDocument();
    expect(screen.getByText("Personal profile")).toBeInTheDocument();
    expect(screen.getByText(/Editorial readiness only—not predicted reach or engagement/)).toBeInTheDocument();
    expect(screen.getByText("Add one supported concrete example.")).toBeInTheDocument();
    expect(screen.getByText("Independent grounding audit passed.")).toBeInTheDocument();
    expect(screen.getByText(/edit and save the draft first/)).toBeInTheDocument();
    expect(screen.queryByText("Edit before applying")).not.toBeInTheDocument();
  });

  it("blocks optimisation for an explicit writing brief and directs the operator to AI Generate", () => {
    render(
      <EngagementIntelligencePanel
        organisationId="org-1" draftId="draft-1" currentDraftVersion={3}
        initialPlatform="linkedin" initialRecommendation={null}
        initialLearningOverview={{ ...learningOverview, platform: "linkedin", latestFeedback: null }}
        initialDraftBody="professional introduction of myself as a professional photography and AI solution provider."
        initialDraftHashtags={[]} draftLocked={false} canWrite={true}
      />,
    );
    expect(screen.getByText("Generate the full draft first")).toBeInTheDocument();
    expect(screen.getByText(/Use AI Generate first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate recommendation" })).toBeDisabled();
  });

  it("marks a legacy LinkedIn score unaudited and prevents it being applied", () => {
    const legacyRecommendation: EngagementRecommendation = {
      ...recommendation,
      platform: "linkedin",
      creativeGuidance: {
        ...recommendation.creativeGuidance,
        linkedinPersonalProfile: {
          accountType: "personal_profile", postArchetype: "point_of_view", readinessScore: 90,
          audiencePromise: "Value", credibilityAnchor: "Legacy claim", conversationPrompt: "Question",
          dimensions: { hook: 5, singleIdea: 5, personalVoice: 4, credibility: 4, scanability: 5, conversationCta: 4 },
          improvementActions: ["Legacy advice"],
        },
      },
    };
    render(
      <EngagementIntelligencePanel
        organisationId="org-1" draftId="draft-1" currentDraftVersion={3}
        initialPlatform="linkedin" initialRecommendation={legacyRecommendation}
        initialLearningOverview={{ ...learningOverview, platform: "linkedin" }}
        initialDraftBody="Existing caption" initialDraftHashtags={[]}
        draftLocked={false} canWrite={true}
      />,
    );
    expect(screen.getByText("LinkedIn personal-profile check · Audit required")).toBeInTheDocument();
    expect(screen.getByText(/predates independent grounding/)).toBeInTheDocument();
    expect(screen.queryByText("90/100")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();
  });

  it("shows a before-and-after confirmation before replacing the saved draft", () => {
    render(
      <EngagementIntelligencePanel
        organisationId="org-1" draftId="draft-1" currentDraftVersion={3}
        initialPlatform="instagram" initialRecommendation={recommendation}
        initialLearningOverview={learningOverview} initialDraftBody="Existing caption"
        initialDraftHashtags={["ExistingTag"]} draftLocked={false} canWrite={true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
    expect(screen.getByText("Confirm draft replacement")).toBeInTheDocument();
    expect(screen.getByText("Existing caption")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply caption + hashtags" })).toBeInTheDocument();
  });
});
