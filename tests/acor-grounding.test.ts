import { describe, expect, it } from "vitest";
import { ACOR_LIFECYCLE, PROOF_DEPTHS, canGroundMembrain, computeGrowthReadiness, deriveGrowthReadinessFromGenesis, emptyImpactCheckpoint, validateBaseline, type AcorEvidence } from "@/core/domain/entities/acor";

const evidence = (overrides: Partial<AcorEvidence> = {}): AcorEvidence => ({ id: "evidence-a", organisationId: "org-uk", evidenceType: "owner confirmation", serviceCategory: "portrait", provenance: "Owner-confirmed ACOR intake", ownerSupplied: true, publicUseStatus: "NOT_APPLICABLE", market: "UK", proves: "Portrait photography is an active service", restrictions: [], verification: "VERIFIED", approval: "APPROVED", ...overrides });

describe("ACOR grounding boundary", () => {
  it("uses the complete generic lifecycle without auto-promoting grounding", () => { expect(ACOR_LIFECYCLE).toEqual(["DISCOVERY", "FORENSIC_REVIEW", "STRATEGY_REQUIRED", "GROUNDING", "GROWTH_READY", "ACTIVE_LEARNING"]); });
  it("supports every proof depth without equating sellable with proven", () => { expect(PROOF_DEPTHS).toContain("CONFIRMED_UNPROVEN"); expect(PROOF_DEPTHS).toContain("NOT_MARKET_READY"); });
  it("allows only verified, human-approved evidence into MemBrain", () => {
    expect(canGroundMembrain(evidence())).toBe(true);
    expect(canGroundMembrain(evidence({ approval: "PROPOSED" }))).toBe(false);
    expect(canGroundMembrain(evidence({ verification: "VERIFY" }))).toBe(false);
    expect(canGroundMembrain(evidence({ verification: "PENDING" }))).toBe(false);
  });
  it("keeps explicit readiness gates honest and does not translate a forensic score", () => {
    const readiness = computeGrowthReadiness({ brand_truth: { met: true, evidence: "approved" }, membrain: { met: true, evidence: "6 categories" }, market_intelligence: { met: true, evidence: "profile" }, conversion_path: { met: true, evidence: "WhatsApp" }, priority_offer_proof: { met: true, evidence: "portrait proof" }, baseline: { met: true, evidence: "day zero" }, platform_connections: { met: false, evidence: "not connected" }, measurement: { met: false, evidence: "not measured" } });
    expect(readiness.lifecycle).toBe("GROUNDING"); expect(readiness.metCount).toBe(6); expect(readiness).not.toHaveProperty("percentage");
  });
  it("derives the Genesis gates without forcing Growth Ready", () => {
    const result = deriveGrowthReadinessFromGenesis({ brandDescriptionReady: true, brandVoiceReady: true, membrainReady: true, marketIntelligenceReady: true, conversionActions: ["WhatsApp"], approvedPriorityProof: true, baselineCaptured: true, connectedPlatformCount: 0, measurementConfigured: false });
    expect(result.lifecycle).toBe("GROUNDING"); expect(result.missing.map(item => item.key)).toEqual(["platform_connections", "measurement"]);
  });
  it("represents Day-0 unknowns and zeroes without fabrication", () => {
    expect(validateBaseline([{ key: "followers", label: "Followers", state: "ACTUAL", value: 3, source: "owner-observed" }, { key: "enquiries", label: "Enquiries", state: "NOT_MEASURED", value: null, source: "none" }])).toHaveLength(2);
    expect(() => validateBaseline([{ key: "reach", label: "Reach", state: "NOT_MEASURED", value: 50, source: "none" }])).toThrow();
  });
  it("keeps 30/60/90 visibility, engagement, intent and commercial outcomes separate", () => {
    for (const day of [30, 60, 90] as const) { const point = emptyImpactCheckpoint(day); expect(point.visibility).not.toHaveProperty("bookings"); expect(point.engagement).not.toHaveProperty("revenue"); expect(point.commercialOutcomes.bookings).toBeNull(); }
  });
  it("contains no client-name production branching", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("src/core/domain/entities/acor.ts", "utf8"));
    expect(source).not.toMatch(/Villiz|Mervic|Nigeria/i);
  });
});
