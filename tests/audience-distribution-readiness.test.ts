import { describe, expect, it } from "vitest";
import { assessRecommendationDistributionEligibility } from "@/core/application/use-cases/engagement";
import type { EngagementFeedbackEvent, EngagementRecommendation } from "@/core/domain/entities/engagement";
import {
  buildVisibilityPlan,
  DISTRIBUTION_READINESS_THRESHOLD,
  visibilityPlanPrompt,
  type VisibilityPlanInput,
} from "@/core/application/use-cases/market-intelligence/visibility";

const readyInput: VisibilityPlanInput = {
  platform: "instagram",
  objectiveType: "enquiries",
  commercialIntent: "convert",
  targetAudience: "Engaged couples looking for documentary wedding photography",
  industry: "Wedding Photography",
  mediaMimeTypes: ["image/jpeg"],
  media: [{ mimeType: "image/jpeg", title: "Approved wedding portrait" }],
  selectedMarketPatternIds: ["pattern-1"],
  selectedMarketPatterns: [{ id: "pattern-1", category: "discovery_language", observation: "Use service and location language naturally.", confidence: 90, provenance: "ACOR review" }],
  targetGeographies: ["Coventry"],
  serviceAreas: ["West Midlands"],
  conversionActions: ["enquiry"],
  platformStrategy: "Use visual-first proof with a specific local buyer hook.",
  hashtagStrategyRoles: ["local", "service", "brand"],
  contentPillar: "Wedding stories",
};

describe("Awo Audience Distribution Gate", () => {
  it("passes only a complete audience, locality and discovery decision", () => {
    const plan = buildVisibilityPlan(readyInput);
    expect(plan.distributionReadinessScore).toBe(100);
    expect(plan.distributionGate).toBe("pass");
    expect(plan.distributionBlockers).toEqual([]);
    expect(plan.targetLocalities).toEqual(["Coventry", "West Midlands"]);
    expect(visibilityPlanPrompt(plan)).toContain(`readiness 100/100 · required ${DISTRIBUTION_READINESS_THRESHOLD}/100`);
  });

  it("blocks a post without an ACOR target locality", () => {
    const plan = buildVisibilityPlan({ ...readyInput, targetGeographies: [], serviceAreas: [] });
    expect(plan.distributionReadinessScore).toBe(80);
    expect(plan.distributionGate).toBe("blocked");
    expect(plan.distributionBlockers).toContain("Configure at least one ACOR target geography or service locality.");
  });

  it("blocks incomplete discovery roles even when generic hashtags exist", () => {
    const plan = buildVisibilityPlan({ ...readyInput, hashtagStrategyRoles: ["brand", "local"] });
    expect(plan.distributionReadinessScore).toBe(85);
    expect(plan.distributionGate).toBe("blocked");
    expect(plan.distributionBlockers).toContain("Configure both local and service discovery/hashtag roles.");
  });

  it("blocks conversion content without a legitimate conversion action", () => {
    const plan = buildVisibilityPlan({ ...readyInput, conversionActions: [] });
    expect(plan.distributionReadinessScore).toBe(95);
    expect(plan.distributionGate).toBe("blocked");
    expect(plan.distributionBlockers).toContain("Configure a legitimate conversion action for this conversion post.");
  });

  it("preserves a passing gate for the exact draft version created by applying that recommendation", () => {
    const recommendation = {
      id: "recommendation-1",
      draftVersion: 3,
      creativeGuidance: { visibilityPlan: buildVisibilityPlan(readyInput) },
    } as EngagementRecommendation;
    const feedback = {
      recommendationId: recommendation.id,
      action: "selected",
      appliedDraftVersion: 4,
    } as EngagementFeedbackEvent;

    expect(assessRecommendationDistributionEligibility(recommendation, 4, feedback)).toEqual({
      eligible: true,
      score: 100,
      blockers: [],
    });
    expect(assessRecommendationDistributionEligibility(recommendation, 5, feedback).eligible).toBe(false);
    expect(assessRecommendationDistributionEligibility(
      recommendation,
      4,
      { ...feedback, recommendationId: "different-recommendation" },
    ).eligible).toBe(false);
  });
});
