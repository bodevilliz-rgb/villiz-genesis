import { describe, expect, it } from "vitest";
import { validateDistributionOutput } from "./awo-distribution-validator";

const base = {
  hook: "Healthy natural hair starts with a simple weekly routine",
  caption: "Build a consistent natural hair care routine around moisture, scalp care and protective styling.",
  cta: "Save this for your next wash day.",
  hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCareUK", "ProtectiveStyling", "UKHairStylist"],
};

const context = {
  brief: "Create a Hairsential Monday post about protective styling, natural hair care and healthy weekly hair routines.",
  targetAudience: "UK women maintaining natural hair and protective styles between salon appointments.",
  evidenceText: "Brand: Mervic Signatures\nLocation: United Kingdom\nService area: UK\nServices: hair styling, protective styling, natural hair care",
};

describe("validateDistributionOutput", () => {
  it("accepts a clean balanced evidence-grounded discovery portfolio", () => {
    const result = validateDistributionOutput(base, context);
    expect(result.ok).toBe(true);
    expect(result.hashtags).toEqual(base.hashtags);
    expect(result.portfolioScore).toBeGreaterThanOrEqual(85);
  });

  it("rejects unexpected scripts in hashtag tokens", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["MervicSignatures创新", ...base.hashtags.slice(1)] }, context);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("unexpected-script");
  });

  it("rejects generic vanity hashtags", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["fyp", ...base.hashtags.slice(1)] }, context);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Generic vanity");
  });

  it("rejects duplicate hashtags case-insensitively", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["MervicSignatures", "mervicsignatures", ...base.hashtags.slice(2)] }, context);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Duplicate hashtags");
  });

  it("strips leading hash characters before validation", () => {
    const result = validateDistributionOutput({ ...base, hashtags: base.hashtags.map((tag) => `#${tag}`) }, context);
    expect(result.ok).toBe(true);
    expect(result.hashtags[0]).toBe("MervicSignatures");
  });

  it("rejects a portfolio that drops verified locality", () => {
    const result = validateDistributionOutput({
      ...base,
      hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCare", "ProtectiveStyling", "HealthyHairCare", "HairCareRoutine"],
    }, context);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("locality signal");
  });

  it("does not invent or require locality when none exists in evidence", () => {
    const noLocality = {
      ...context,
      targetAudience: "Women maintaining natural hair and protective styles between salon appointments.",
      evidenceText: "Brand: Mervic Signatures\nServices: hair styling, protective styling, natural hair care",
    };
    const result = validateDistributionOutput({
      ...base,
      hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCare", "ProtectiveStyling", "HealthyHairCare", "HairCareRoutine"],
    }, noLocality);
    expect(result.errors.join(" ")).not.toContain("locality signal");
  });

  it("rejects a portfolio with weak evidence grounding even if tokens are syntactically valid", () => {
    const result = validateDistributionOutput({
      ...base,
      hashtags: ["MervicSignatures", "MondayMotivation", "BeautyLifestyle", "ConfidenceDaily", "SelfCareJourney", "GoodVibesOnly"],
    }, context);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("weakly grounded");
  });
});
