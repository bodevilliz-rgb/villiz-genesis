import { describe, expect, it } from "vitest";
import { DISTRIBUTION_PRODUCTION_GATE, validateDistributionOutput } from "./awo-distribution-validator";
import type { CampaignDistributionProfile } from "./awo-campaign-distribution-profile";

const base = {
  hook: "Healthy natural hair starts with a simple weekly routine",
  caption: "Build a consistent natural hair care routine around moisture, scalp care and protective styling.",
  cta: "Save this for your next wash day.",
  hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCareUK", "ProtectiveStyling", "UKHairStylist", "HealthyHairCare"],
};

const context = {
  brief: "Create a Hairsential Monday post about protective styling, natural hair care and healthy weekly hair routines.",
  targetAudience: "UK women maintaining natural hair and protective styles between salon appointments.",
  evidenceText: "Brand: Mervic Signatures\nLocation: United Kingdom\nService area: UK\nServices: hair styling, protective styling, natural hair care",
};

const sharedProfile: CampaignDistributionProfile = {
  campaignName: "Hairsential Monday",
  brandTokens: ["mervic", "signatures", "hairsential", "monday"],
  serviceTokens: ["protective", "styling", "natural", "hair", "care", "healthy", "routine"],
  audienceTokens: ["women", "maintaining", "natural", "hair", "protective", "styles", "salon", "appointments"],
  localityTokens: ["uk", "unitedkingdom"],
  localityRequired: true,
  objectiveTokens: ["engagement"],
  evidenceText: context.evidenceText,
};

describe("validateDistributionOutput", () => {
  it("accepts a clean balanced portfolio only when it reaches the 95 production gate", () => {
    const result = validateDistributionOutput(base, { ...context, profile: sharedProfile });
    expect(result.ok).toBe(true);
    expect(result.hashtags).toEqual(base.hashtags);
    expect(result.portfolioScore).toBeGreaterThanOrEqual(DISTRIBUTION_PRODUCTION_GATE);
  });

  it("rejects unexpected scripts in hashtag tokens", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["MervicSignatures创新", ...base.hashtags.slice(1)] }, { ...context, profile: sharedProfile });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("unexpected-script");
  });

  it("rejects generic vanity hashtags", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["fyp", ...base.hashtags.slice(1)] }, { ...context, profile: sharedProfile });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Generic vanity");
  });

  it("rejects duplicate hashtags case-insensitively", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["MervicSignatures", "mervicsignatures", ...base.hashtags.slice(2)] }, { ...context, profile: sharedProfile });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Duplicate hashtags");
  });

  it("strips leading hash characters before validation", () => {
    const result = validateDistributionOutput({ ...base, hashtags: base.hashtags.map((tag) => `#${tag}`) }, { ...context, profile: sharedProfile });
    expect(result.ok).toBe(true);
    expect(result.hashtags[0]).toBe("MervicSignatures");
  });

  it("blocks the exact Instagram regression: shared UK profile but no locality hashtag", () => {
    const result = validateDistributionOutput({
      ...base,
      hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCare", "ProtectiveStyling", "HealthyHairCare", "HairCareRoutine"],
    }, {
      brief: context.brief,
      targetAudience: context.targetAudience,
      evidenceText: "Per-post context intentionally omits locality.",
      profile: sharedProfile,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("requires locality");
  });

  it("rejects a required profile bucket even when the aggregate score would otherwise look strong", () => {
    const result = validateDistributionOutput({
      ...base,
      hashtags: ["HairsentialMonday", "NaturalHairCareUK", "ProtectiveStylingUK", "UKHairStylist", "HealthyHairCare", "HairCareRoutine"],
    }, { ...context, profile: { ...sharedProfile, brandTokens: ["mervic", "signatures"] } });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("brand/owned");
  });

  it("does not invent or require locality when the shared profile has none", () => {
    const noLocalityProfile: CampaignDistributionProfile = {
      ...sharedProfile,
      localityTokens: [],
      localityRequired: false,
      evidenceText: "Brand: Mervic Signatures\nServices: hair styling, protective styling, natural hair care",
    };
    const result = validateDistributionOutput({
      ...base,
      hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCare", "ProtectiveStyling", "HealthyHairCare", "HairCareRoutine"],
    }, { ...context, targetAudience: "Women maintaining natural hair and protective styles.", profile: noLocalityProfile });
    expect(result.errors.join(" ")).not.toContain("requires locality");
  });

  it("rejects a portfolio below the 95 production eligibility gate", () => {
    const result = validateDistributionOutput({
      ...base,
      hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCareUK", "ProtectiveStyling", "BeautyLifestyle", "SelfCareJourney"],
    }, { ...context, profile: sharedProfile });
    expect(result.ok).toBe(false);
    expect(result.portfolioScore).toBeLessThan(DISTRIBUTION_PRODUCTION_GATE);
    expect(result.errors.join(" ")).toContain("production eligibility gate");
  });
});
