import { describe, expect, it } from "vitest";
import { resolveCampaignDistributionProfile } from "./awo-campaign-distribution-profile";
import { validateDistributionOutput } from "./awo-distribution-validator";

const content = {
  hook: "How to prepare natural hair for protective styling",
  caption: "Build a healthy routine around cleansing, hydration and gentle preparation before your next protective style.",
  cta: "Save this before your next hair appointment.",
};

describe("Campaign Distribution Profile enforcement", () => {
  const profile = resolveCampaignDistributionProfile("Hairsential Monday", [{
    brief: "Natural hair care and protective styling education.",
    targetAudience: "Women maintaining natural hair and protective styles.",
    memBrainContextPrompt: "Brand name: Mervic Signatures\nService area: Coventry, United Kingdom\nMarket: UK",
  }]);

  it("rejects a clean-looking post that drops required campaign locality", () => {
    const result = validateDistributionOutput({
      ...content,
      hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCare", "ProtectiveStyling", "HealthyHairCare", "HairCareRoutine"],
    }, { profile });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("requires locality");
  });

  it("accepts a grounded portfolio when the same shared locality profile is satisfied", () => {
    const result = validateDistributionOutput({
      ...content,
      hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCareUK", "ProtectiveStyling", "HealthyHairCare", "CoventryHair"],
    }, { profile });

    expect(result.ok).toBe(true);
    expect(result.portfolioScore).toBeGreaterThanOrEqual(85);
  });
});
