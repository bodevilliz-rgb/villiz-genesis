import { describe, expect, it } from "vitest";
import { validateDistributionOutput } from "./awo-distribution-validator";

const base = {
  hook: "Healthy natural hair starts with a simple weekly routine",
  caption: "Build a consistent natural hair care routine around moisture, scalp care and protective styling.",
  cta: "Save this for your next wash day.",
  hashtags: ["MervicSignatures", "HairsentialMonday", "NaturalHairCareUK", "ProtectiveStyling", "UKHairStylist"],
};

describe("validateDistributionOutput", () => {
  it("accepts clean evidence-grounded hashtag tokens", () => {
    const result = validateDistributionOutput(base);
    expect(result.ok).toBe(true);
    expect(result.hashtags).toEqual(base.hashtags);
  });

  it("rejects unexpected scripts in hashtag tokens", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["MervicSignatures创新", ...base.hashtags.slice(1)] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("unexpected-script");
  });

  it("rejects generic vanity hashtags", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["fyp", ...base.hashtags.slice(1)] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Generic vanity");
  });

  it("rejects duplicate hashtags case-insensitively", () => {
    const result = validateDistributionOutput({ ...base, hashtags: ["MervicSignatures", "mervicsignatures", ...base.hashtags.slice(2)] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Duplicate hashtags");
  });

  it("strips leading hash characters before validation", () => {
    const result = validateDistributionOutput({ ...base, hashtags: base.hashtags.map((tag) => `#${tag}`) });
    expect(result.ok).toBe(true);
    expect(result.hashtags[0]).toBe("MervicSignatures");
  });
});
