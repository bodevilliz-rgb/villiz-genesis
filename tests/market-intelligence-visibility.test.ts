import { describe, expect, it } from "vitest";
import { buildVisibilityPlan, deriveClientVisibilityEvidence, resolveVerticalPlaybook, VERTICAL_PLAYBOOKS, VISIBILITY_STRATEGY_VERSION } from "@/core/application/use-cases/market-intelligence/visibility";
import type { EngagementMetricSnapshot, EngagementRecommendation } from "@/core/domain/entities/engagement";

const base = { platform: "instagram" as const, objectiveType: "bookings" as const, commercialIntent: "convert" as const, targetAudience: "Couples planning a verified local wedding", industry: "Wedding photography", mediaMimeTypes: ["image/jpeg", "image/png"], selectedMarketPatternIds: [] };

describe("adaptive visibility intelligence", () => {
  it("provides version-controlled, client-neutral playbooks for the three required verticals", () => {
    expect(resolveVerticalPlaybook("Wedding Photography")?.key).toBe("photography");
    expect(resolveVerticalPlaybook("Hair and beauty salon")?.key).toBe("hair_beauty");
    expect(resolveVerticalPlaybook("Professional services consultancy")?.key).toBe("professional_services");
    expect(Object.values(VERTICAL_PLAYBOOKS).every((playbook) => playbook.version === "vertical-v1")).toBe(true);
    expect(JSON.stringify(VERTICAL_PLAYBOOKS)).not.toMatch(/Villiz|Mervic/i);
  });

  it("produces a complete, compatible visibility hypothesis without claiming timing evidence", () => {
    const plan = buildVisibilityPlan(base);
    expect(plan.contentFormat).toBe("carousel");
    expect(plan.visibilityEvidenceLevel).toBe("FOUNDATION_HYPOTHESIS");
    expect(plan.publishingWindow).toBe("Not enough account-specific evidence yet.");
    expect(plan.supportingDistributionActions.length).toBeLessThanOrEqual(3);
    expect(plan.measurementPlan).toContain("booking outcomes separately");
    expect(VISIBILITY_STRATEGY_VERSION).toBe("visibility-v1");
  });

  it("allows sufficiently reliable client evidence to override a photography video hypothesis", () => {
    const plan = buildVisibilityPlan({ ...base, mediaMimeTypes: ["image/jpeg", "image/png", "video/mp4"], clientEvidence: { sampleSize: 12, preferredFormat: "carousel", preferredHook: "question" } });
    expect(plan.contentFormat).toBe("carousel");
    expect(plan.hookStrategy).toBe("question");
    expect(plan.visibilityEvidenceLevel).toBe("CLIENT_EVIDENCE");
  });

  it("derives an override only from comparable attributed account results", () => {
    const recommendations = [
      { id: "carousel", organisationId: "org-a", platform: "instagram", objectiveType: "engagement", strategyMetadata: { contentFormat: "carousel", hookFamily: "question" } },
      { id: "video", organisationId: "org-a", platform: "instagram", objectiveType: "engagement", strategyMetadata: { contentFormat: "short_form_video", hookFamily: "transformation" } },
    ] as unknown as EngagementRecommendation[];
    const snapshots = Array.from({ length: 12 }, (_, index) => ({
      organisationId: "org-a",
      platform: "instagram",
      providerAccountId: "account-a",
      objectiveType: "engagement",
      externalPostId: `post-${index}`,
      recommendationId: index < 7 ? "carousel" : "video",
      measurementWindow: "7d",
      observedAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      metrics: { reach: 1000, comments: index < 7 ? 20 : 2, shares: 0, saves: 0, likes: 0 },
    })) as unknown as EngagementMetricSnapshot[];
    const derive = (items: EngagementMetricSnapshot[]) => deriveClientVisibilityEvidence({ snapshots: items, recommendations, organisationId: "org-a", platform: "instagram", providerAccountId: "account-a", objective: "engagement" });
    expect(derive(snapshots)).toEqual({ sampleSize: 12, preferredFormat: "carousel", preferredHook: "question" });
    expect(derive(snapshots.slice(0, 9))).toBeNull();
    for (const mismatch of [
      { organisationId: "org-b" },
      { platform: "facebook" },
      { providerAccountId: "account-b" },
      { objectiveType: "awareness" },
    ]) expect(derive(snapshots.map((snapshot) => ({ ...snapshot, ...mismatch })) as EngagementMetricSnapshot[])).toBeNull();
  });

  it("does not let weak evidence override a vertical hypothesis", () => {
    const plan = buildVisibilityPlan({ ...base, clientEvidence: { sampleSize: 9, preferredFormat: "single_image", preferredHook: "question" } });
    expect(plan.contentFormat).toBe("carousel");
    expect(plan.hookStrategy).not.toBe("transformation");
    expect(plan.visibilityEvidenceLevel).toBe("FOUNDATION_HYPOTHESIS");
  });

  it("never recommends media the draft cannot support and keeps unknown audiences honest", () => {
    const plan = buildVisibilityPlan({ ...base, targetAudience: null, mediaMimeTypes: [], clientEvidence: { sampleSize: 20, preferredFormat: "short_form_video", preferredHook: null } });
    expect(plan.contentFormat).not.toBe("short_form_video");
    expect(plan.targetAudience).toBe("No legitimate target audience is currently configured.");
  });

  it("treats approved market patterns as hypotheses rather than performance proof", () => {
    const plan = buildVisibilityPlan({ ...base, industry: "Unknown vertical", selectedMarketPatternIds: ["pattern-1"] });
    expect(plan.visibilityEvidenceLevel).toBe("MARKET_EVIDENCE");
    expect(plan.rationale).toContain("promise of performance");
  });

  it.each(["convert", "engage", "build_trust"] as const)("keeps an unknown vertical useful for %s without inheriting a known playbook", (commercialIntent) => {
    const plan = buildVisibilityPlan({ ...base, commercialIntent, objectiveType: "engagement", industry: "Independent product retailer", mediaMimeTypes: ["image/jpeg"], targetAudience: "Verified product audience" });
    expect(plan.verticalIntelligenceAvailable).toBe(false);
    expect(plan.visibilityEvidenceLevel).toBe("GENERAL_PLATFORM_OPTION");
    expect(plan.contentFormat).toBe("single_image");
    expect(plan.rationale).not.toMatch(/photography|hair|professional services/i);
  });

  it("keeps a non-service product brand free of service-business assumptions", () => {
    const plan = buildVisibilityPlan({ ...base, industry: "Retail product brand", objectiveType: "awareness", commercialIntent: "engage", targetAudience: "Verified product audience", mediaMimeTypes: ["image/jpeg"], selectedMarketPatternIds: [] });
    expect(JSON.stringify(plan)).not.toMatch(/booking|appointment|consultation|before.?after|transformation|local service/i);
    expect(plan.measurementPlan).toContain("reach or views");
  });

  it("labels weak evidence when no stronger market or vertical basis exists", () => {
    expect(buildVisibilityPlan({ ...base, industry: "Unknown", selectedMarketPatternIds: [], clientEvidence: { sampleSize: 4, preferredFormat: "single_image", preferredHook: "question" } }).visibilityEvidenceLevel).toBe("INSUFFICIENT_EVIDENCE");
  });

  it.each([
    ["Independent photography studio", "portrait"],
    ["Hair and beauty salon", "care concern"],
    ["Professional services consultancy", "clearer decision"],
    ["Independent product maker", "specific difference"],
  ])("resolves a usable Foundation hook before copy for %s", (industry, expected) => {
    const plan = buildVisibilityPlan({ ...base, industry, mediaMimeTypes: [], selectedMarketPatternIds: [], targetAudience: "One configured primary audience" });
    expect(plan.actualHook.toLocaleLowerCase()).toContain(expected);
    expect(plan.actualHook).not.toMatch(/no evidence-grounded hook/i);
  });

  it("uses discovery dimensions without inventing geography or reducing discovery to hashtags", () => {
    const discovery = buildVisibilityPlan({ ...base, targetAudience: null }).discoveryStrategy;
    expect(discovery).toMatch(/natural.*language/i);
    expect(discovery).toContain("do not invent");
  });

  it("uses approved portrait metadata without inventing transformation evidence", () => {
    const plan = buildVisibilityPlan({ ...base, mediaMimeTypes: ["image/jpeg"], media: [{ mimeType: "image/jpeg", title: "Studio portrait", altText: "Approved professional portrait", tags: ["portrait"] }], targetGeographies: ["Coventry"], serviceAreas: ["West Midlands"], conversionActions: ["whatsapp_enquiry"], contentPillar: "Portrait confidence" });
    expect(plan.mediaObservation).toContain("Approved professional portrait");
    expect(plan.mediaObservation).toContain("NOT VISUALLY ANALYSED");
    expect(plan.hookStrategy).not.toBe("transformation");
    expect(plan.hookStrategy).not.toBe("occasion_milestone");
    expect(plan.hookStrategy).not.toBe("proof_result");
    expect(plan.discoveryStrategy).toContain("Coventry");
    expect(plan.ctaStrategy).toContain("whatsapp enquiry");
    expect(plan.contentPillar).toBe("Portrait confidence");
  });

  it("labels video honestly when the provider cannot inspect its content", () => {
    const plan = buildVisibilityPlan({ ...base, mediaMimeTypes: ["video/mp4"], media: [{ mimeType: "video/mp4", title: "Portrait session clip" }] });
    expect(plan.mediaObservation).toMatch(/^VIDEO CONTENT NOT ANALYSED/);
    expect(plan.contentFormat).toBe("short_form_video");
  });

  it("uses transformation only when selected media metadata explicitly supports it", () => {
    const plan = buildVisibilityPlan({ ...base, mediaMimeTypes: ["image/jpeg", "image/jpeg"], media: [{ mimeType: "image/jpeg", altText: "Before and after portrait retouch comparison" }, { mimeType: "image/jpeg", altText: "Approved result" }] });
    expect(plan.hookStrategy).toBe("transformation");
  });

  it("uses request-scoped visual analysis and a chosen MemBrain pillar in the decision", () => {
    const plan = buildVisibilityPlan({ ...base, mediaMimeTypes: ["image/jpeg"], mediaObservation: "Asset type: still image\nSubject structure: single person\nVisual style: constructed editorial portrait", targetAudienceOverride: "People seeking distinctive editorial portrait photography", contentPillar: "Creative and editorial craft", contentPillarRationale: "The visible constructed portrait treatment aligns with editorial craft.", goalRationale: "Awo recommends conversion because WhatsApp enquiry is configured.", hookStrategyOverride: "confidence", actualHook: "Your portrait can make a statement before you say a word." });
    expect(plan.mediaObservation).toContain("constructed editorial portrait");
    expect(plan.targetAudience).toBe("People seeking distinctive editorial portrait photography");
    expect(plan.contentPillar).toBe("Creative and editorial craft");
    expect(plan.contentPillarRationale).toContain("visible constructed portrait");
    expect(plan.goalRationale).toContain("WhatsApp enquiry");
    expect(plan.hookStrategy).toBe("confidence");
    expect(plan.actualHook).toBe("Your portrait can make a statement before you say a word.");
  });
});
