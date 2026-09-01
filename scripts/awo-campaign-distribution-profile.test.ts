import { describe, expect, it } from "vitest";
import { resolveCampaignDistributionProfile } from "./awo-campaign-distribution-profile";

describe("resolveCampaignDistributionProfile", () => {
  it("resolves verified locality once for the whole campaign", () => {
    const profile = resolveCampaignDistributionProfile("Hairsential Monday", [
      {
        brief: "Educate clients about natural hair care and protective styling.",
        targetAudience: "Women maintaining natural hair and protective styles.",
        memBrainContextPrompt: "Brand name: Mervic Signatures\nService area: Coventry, United Kingdom\nMarket: UK",
      },
      {
        brief: "Prepare clients for their next hair appointment.",
        targetAudience: "Protective styling clients.",
        memBrainContextPrompt: "Brand name: Mervic Signatures\nService area: Coventry, United Kingdom",
      },
    ]);

    expect(profile.localityRequired).toBe(true);
    expect(profile.localityTokens).toEqual(expect.arrayContaining(["coventry", "unitedkingdom", "uk"]));
    expect(profile.brandTokens).toEqual(expect.arrayContaining(["mervic", "signatures"]));
    expect(profile.serviceTokens).toEqual(expect.arrayContaining(["natural", "hair", "protective", "styling"]));
  });

  it("does not require or invent locality when campaign evidence has none", () => {
    const profile = resolveCampaignDistributionProfile("Global Product Education", [
      {
        brief: "Explain product benefits and care routines.",
        targetAudience: "Existing customers and prospects.",
        memBrainContextPrompt: "Brand name: Example Brand\nTone: helpful and precise",
      },
    ]);

    expect(profile.localityRequired).toBe(false);
    expect(profile.localityTokens).toEqual([]);
  });
});
