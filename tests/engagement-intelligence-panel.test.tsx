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
    visibilityPlan: {
      goal: "engage", goalRationale: "Support conversation.", contentJob: "DISCOVERY",
      targetAudience: "Portrait clients in Coventry", mediaObservation: "A portrait image is attached.",
      contentPillar: "Portrait confidence", contentPillarRationale: "Selected from MemBrain.",
      contentFormat: "single_image", formatRationale: "Matches the attached media.",
      attentionMechanism: "Identity-led portrait", hookStrategy: "question", actualHook: "A portrait that feels like you.",
      discoveryStrategy: "Use verified local and portrait language.", targetLocalities: ["Coventry"],
      platformStrategy: "Use visual proof for local discovery.", discoveryRoles: ["local", "service"],
      distributionReadinessScore: 100, distributionGate: "pass", distributionBlockers: [],
      searchableLanguage: ["Coventry portrait photographer"], ctaStrategy: "Invite a booking enquiry.",
      measurementPlan: "Measure qualified enquiries.", supportingDistributionActions: ["Reshare to Stories."],
      publishingWindow: "Not enough evidence yet.", publishingWindowEvidenceState: "INSUFFICIENT_ACCOUNT_EVIDENCE",
      visibilityEvidenceLevel: "CLIENT_EVIDENCE", verticalIntelligenceAvailable: true,
      evidenceSources: ["MemBrain"], confidence: 80, foundationVersion: "v1",
      rationale: "Uses configured client evidence.",
    },
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
  latestPostMetrics: [],
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

  it("renders and blocks a recommendation created before the distribution gate existed", () => {
    const legacyVisibilityPlan = { ...recommendation.creativeGuidance.visibilityPlan } as Record<string, unknown>;
    delete legacyVisibilityPlan.distributionGate;
    delete legacyVisibilityPlan.distributionReadinessScore;
    delete legacyVisibilityPlan.distributionBlockers;
    delete legacyVisibilityPlan.contentFormat;
    delete legacyVisibilityPlan.visibilityEvidenceLevel;
    delete legacyVisibilityPlan.targetLocalities;
    delete legacyVisibilityPlan.supportingDistributionActions;
    const legacyRecommendation = {
      ...recommendation,
      creativeGuidance: {
        ...recommendation.creativeGuidance,
        visibilityPlan: legacyVisibilityPlan,
      },
    } as unknown as EngagementRecommendation;

    render(
      <EngagementIntelligencePanel
        organisationId="org-1" draftId="draft-1" currentDraftVersion={3}
        initialPlatform="instagram" initialRecommendation={legacyRecommendation}
        initialLearningOverview={learningOverview} initialDraftBody="Existing caption"
        initialDraftHashtags={[]} draftLocked={false} canWrite={true}
      />,
    );

    expect(screen.getByText(/predates the Audience Distribution Gate/)).toBeInTheDocument();
    expect(screen.getByText(/Readiness 0\/100/)).toBeInTheDocument();
    expect(screen.getByText(/uses an earlier contract and cannot be trusted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review caption + hashtags" })).toBeDisabled();
  });

  it("makes a blocked distribution recommendation visibly ineligible and impossible to review", () => {
    const blockedRecommendation: EngagementRecommendation = {
      ...recommendation,
      creativeGuidance: {
        ...recommendation.creativeGuidance,
        visibilityPlan: {
          ...recommendation.creativeGuidance.visibilityPlan!,
          targetAudience: "No legitimate target audience is currently configured.",
          targetLocalities: [],
          discoveryRoles: [],
          searchableLanguage: [],
          distributionGate: "blocked",
          distributionReadinessScore: 45,
          distributionBlockers: [
            "Configure the exact buyer/audience Awo should address.",
            "Configure at least one ACOR target geography or service locality.",
          ],
        },
      },
    };
    render(
      <EngagementIntelligencePanel
        organisationId="org-1" draftId="draft-1" currentDraftVersion={3}
        initialPlatform="instagram" initialRecommendation={blockedRecommendation}
        initialLearningOverview={learningOverview} initialDraftBody="Existing caption"
        initialDraftHashtags={[]} draftLocked={false} canWrite={true}
      />,
    );

    expect(screen.getByRole("alert", { name: "Audience Distribution Gate" })).toHaveTextContent("BLOCKED");
    expect(screen.getByRole("alert", { name: "Audience Distribution Gate" })).toHaveTextContent("45/100");
    expect(screen.getByText("Configure the exact buyer/audience Awo should address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review caption + hashtags" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /Edit the recommendation before applying/i })).toBeDisabled();
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
      hashtags: { brand: [], local: [], service: [], audience: [] },
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
    expect(screen.getByText(/clean, keyword-rich copy without hashtags/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review caption without hashtags" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "Review caption without hashtags" })).toBeDisabled();
  });

  it("blocks an audited legacy LinkedIn recommendation that still contains hashtags", () => {
    const legacyHashtagRecommendation: EngagementRecommendation = {
      ...recommendation,
      platform: "linkedin",
      creativeGuidance: {
        ...recommendation.creativeGuidance,
        linkedinPersonalProfile: {
          accountType: "personal_profile", postArchetype: "point_of_view", readinessScore: 90,
          audiencePromise: "Value", credibilityAnchor: "Supported", conversationPrompt: "Question",
          dimensions: { hook: 5, singleIdea: 5, personalVoice: 4, credibility: 4, scanability: 5, conversationCta: 4 },
          improvementActions: [], auditStatus: "passed", auditAttempts: 1,
          credibilityEvidenceIds: ["entry-1"],
        },
      },
    };
    render(
      <EngagementIntelligencePanel
        organisationId="org-1" draftId="draft-1" currentDraftVersion={3}
        initialPlatform="linkedin" initialRecommendation={legacyHashtagRecommendation}
        initialLearningOverview={{ ...learningOverview, platform: "linkedin" }}
        initialDraftBody="Existing caption" initialDraftHashtags={[]}
        draftLocked={false} canWrite={true}
      />,
    );
    expect(screen.getByText(/contains legacy hashtags/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review caption without hashtags" })).toBeDisabled();
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
    expect(screen.getByText(/also replaces the draft hashtags with the 3 suggested hashtags/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review caption + hashtags" }));
    expect(screen.getByText("Confirm draft replacement")).toBeInTheDocument();
    expect(screen.getByText("Existing caption")).toBeInTheDocument();
    expect(screen.getByText("Current hashtags: 1 · Replacement hashtags: 3. This creates a new draft version; approval remains mandatory.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply caption + hashtags" })).toBeInTheDocument();
  });

  it("shows factual metrics and attribution for the latest published post", () => {
    const metric = {
      id: "metric-1", organisationId: "org-1", draftId: "draft-1", publishingAttemptId: "attempt-1",
      recommendationId: "rec-1", feedbackEventId: "feedback-1", selectedVariant: "recommended" as const,
      platform: "instagram" as const, objectiveType: "engagement" as const, providerAccountId: "account-1",
      externalPostId: "post-1", providerSnapshotKey: "snapshot-1", observedAt: "2026-08-11T12:00:00Z",
      providerCapturedAt: "2026-08-11T12:00:00Z", measurementWindow: "24h" as const,
      metrics: { reach: 800, views: 1000, impressions: 1200, likes: 40, comments: 5, shares: 8, saves: 7, clicks: 3 },
      rawMetrics: {}, createdAt: "2026-08-11T12:00:00Z",
    };
    render(
      <EngagementIntelligencePanel
        organisationId="org-1" draftId="draft-1" currentDraftVersion={3}
        initialPlatform="instagram" initialRecommendation={recommendation}
        initialLearningOverview={{ ...learningOverview, latestDraftMetric: metric, latestPostMetrics: [metric] }}
        initialDraftBody="Existing caption" initialDraftHashtags={[]}
        draftLocked={false} canWrite={true}
      />,
    );
    expect(screen.getByRole("heading", { name: "Post performance" })).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getAllByText(/Attribution verified/).length).toBeGreaterThan(0);
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(screen.getByText("7 days")).toBeInTheDocument();
  });
});
