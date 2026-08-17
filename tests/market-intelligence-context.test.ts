import { describe, expect, it } from "vitest";
import { assembleMarketGenerationContext, rejectsCompetitorImitation } from "@/core/application/use-cases/market-intelligence/context";
import { marketProfileReadiness, profileFromTemplate, type MarketIntelligenceSnapshot } from "@/core/domain/entities/market-intelligence";

const snapshot: MarketIntelligenceSnapshot = {
  profile: { organisationId: "org-a", businessObjectives: ["bookings"], targetGeographies: ["Coventry"], serviceAreas: ["West Midlands"], audienceContext: "Configured audience", culturalContext: "UK Nigerian diaspora", promotionalFocus: "Qualified enquiries", culturalVoiceLevel: "light_naija", conversionActions: ["enquiry"], platformStrategy: { instagram: "Use concise visual-first copy" }, hashtagStrategy: { local: "Use verified service areas" }, createdAt: "2026-08-16", updatedAt: "2026-08-16" },
  references: [],
  patterns: [{ id: "pattern-a", organisationId: "org-a", observation: "Transformation posts can open with an outcome-led hook and then show supported proof.", category: "transformation", platform: "instagram", market: "UK", vertical: "services", provenance: "Human-reviewed research", sourceUrl: null, confidence: 70, observedAt: null, reviewedAt: "2026-08-16", isActive: true, createdAt: "2026-08-16", updatedAt: "2026-08-16" }],
};

describe("Market Intelligence generation context", () => {
  it("is an exact neutral no-op when no repository/profile exists", async () => {
    expect(await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram" })).toEqual({ enabled: false, commercialIntent: "engage", commercialIntentSource: "recommended", culturalVoiceLevel: "neutral", selectedPatternIds: [], selectedPatterns: [], targetAudience: null, targetGeographies: [], serviceAreas: [], conversionActions: [], prompt: "" });
    expect((await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram", marketIntelligence: { getSnapshot: async () => ({ profile: null, references: [], patterns: [] }) } })).enabled).toBe(false);
  });
  it.each(["convert", "engage", "build_trust"] as const)("renders the %s intent", async (commercialIntent) => {
    const result = await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram", commercialIntent, marketIntelligence: { getSnapshot: async (id) => { expect(id).toBe("org-a"); return snapshot; } } });
    expect(result.prompt).toContain(`Commercial intent: ${commercialIntent.toUpperCase()}`);
  });
  it("applies light Naija only from the organisation profile and includes anti-copy rules", async () => {
    const result = await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram", marketIntelligence: { getSnapshot: async () => snapshot } });
    expect(result.prompt).toContain("restrained Nigerian rhythm"); expect(result.prompt).toContain("Never reproduce or closely paraphrase competitor copy");
  });
  it.each(["Wedding Photography", "Hair and Beauty", "UK photographer", "Nigerian-owned retailer"])("does not infer cultural voice from %s", async () => {
    const neutral = { ...snapshot, profile: { ...snapshot.profile!, culturalVoiceLevel: "neutral" as const, culturalContext: null } };
    const result = await assembleMarketGenerationContext({ organisationId: "org-neutral", platform: "instagram", marketIntelligence: { getSnapshot: async () => neutral } });
    expect(result.culturalVoiceLevel).toBe("neutral");
    expect(result.prompt).not.toContain("restrained Nigerian rhythm");
  });
  it("keeps explicit Nigerian cultural configuration organisation-scoped", async () => {
    const repository = { getSnapshot: async (id: string) => id === "org-naija" ? { ...snapshot, profile: { ...snapshot.profile!, organisationId: id } } : { ...snapshot, profile: { ...snapshot.profile!, organisationId: id, culturalVoiceLevel: "neutral" as const, culturalContext: null } } };
    expect((await assembleMarketGenerationContext({ organisationId: "org-naija", platform: "instagram", marketIntelligence: repository })).culturalVoiceLevel).toBe("light_naija");
    expect((await assembleMarketGenerationContext({ organisationId: "org-neutral", platform: "instagram", marketIntelligence: repository })).culturalVoiceLevel).toBe("neutral");
  });
  it("allows an explicit per-recommendation cultural treatment only when approved context exists", async () => {
    const configured = await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram", culturalVoiceLevel: "conversational", marketIntelligence: { getSnapshot: async () => snapshot } });
    const light = await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram", culturalVoiceLevel: "light_naija", marketIntelligence: { getSnapshot: async () => snapshot } });
    const noContext = { ...snapshot, profile: { ...snapshot.profile!, culturalVoiceLevel: "neutral" as const, culturalContext: null } };
    const blocked = await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram", culturalVoiceLevel: "light_naija", marketIntelligence: { getSnapshot: async () => noContext } });
    expect(configured.culturalVoiceLevel).toBe("conversational"); expect(light.culturalVoiceLevel).toBe("light_naija"); expect(blocked.culturalVoiceLevel).toBe("neutral");
  });
  it("does not select inactive, other-platform, or cross-client patterns", async () => {
    const patterns = [...snapshot.patterns, { ...snapshot.patterns[0]!, id: "inactive", isActive: false }, { ...snapshot.patterns[0]!, id: "other", platform: "facebook" }, { ...snapshot.patterns[0]!, id: "cross-client", organisationId: "org-b" }];
    const result = await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram", marketIntelligence: { getSnapshot: async (id) => ({ ...snapshot, patterns: id === "org-a" ? patterns : [] }) } });
    expect(result.selectedPatternIds).toEqual(["pattern-a"]);
  });
  it("gives Awo proof depth with confidence and provenance while preserving sellable services", async () => {
    const proof = { ...snapshot.patterns[0]!, id: "proof-depth", category: "proof" as const, observation: "Videography: CONFIRMED_UNPROVEN. Creative/editorial photography: ADEQUATELY_PROVEN.", provenance: "ACOR forensic review plus owner-confirmed catalogue and inspected proof pack", confidence: 95 };
    const result = await assembleMarketGenerationContext({ organisationId: "org-a", platform: "instagram", marketIntelligence: { getSnapshot: async () => ({ ...snapshot, patterns: [proof] }) } });
    expect(result.prompt).toContain("confidence 95/100");
    expect(result.prompt).toContain(proof.provenance);
    expect(result.prompt).toContain("Videography: CONFIRMED_UNPROVEN");
    expect(result.prompt).toContain("not whether a MemBrain-confirmed service is sellable");
    expect(result.prompt).toContain("never turn it into an absolute prohibition");
    expect(result.prompt).toContain("ADEQUATELY_PROVEN is not STRONGLY_PROVEN");
    expect(result.prompt).toContain("Visual proof is not testimonial, consent or commercial-outcome evidence");
  });
  it("rejects a cross-organisation profile even if a repository returns one incorrectly", async () => {
    const result = await assembleMarketGenerationContext({ organisationId: "org-b", platform: "instagram", marketIntelligence: { getSnapshot: async () => snapshot } });
    expect(result.enabled).toBe(false);
    expect(result.culturalVoiceLevel).toBe("neutral");
  });
  it("rejects named imitation instructions but accepts abstract observations", () => {
    expect(rejectsCompetitorImitation("Write in the style of @competitor")).toBe(true);
    expect(rejectsCompetitorImitation("Use an outcome-led transformation hook")).toBe(false);
  });
  it("calculates readiness deterministically", () => expect(marketProfileReadiness(snapshot.profile)).toEqual({ complete: 6, total: 6, percentage: 100 }));
  it("duplicates only version-controlled structure", () => {
    const cloned = profileFromTemplate("org-b", { businessObjectives: ["visibility"], culturalVoiceLevel: "neutral", platformStrategy: {}, hashtagStrategy: { brand: "Use owned brand tags" } });
    expect(cloned.organisationId).toBe("org-b"); expect(cloned.audienceContext).toBeNull(); expect(cloned.conversionActions).toEqual([]);
    for (const privateData of ["membrain", "references", "patterns", "campaigns", "performance", "engagementLearning", "commercialOutcomes", "customers"]) expect(cloned).not.toHaveProperty(privateData);
  });
});
