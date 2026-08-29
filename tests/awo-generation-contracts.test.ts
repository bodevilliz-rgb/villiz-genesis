import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assembleMarketGenerationContext, recommendCommercialIntent } from "@/core/application/use-cases/market-intelligence/context";
import type { MarketIntelligenceProfile, MarketPattern } from "@/core/domain/entities/market-intelligence";
import { resolveActivePillarSelection } from "@/server/actions/awo-grounding";

const awoActionSource = readFileSync("src/server/actions/awo.ts", "utf8");
const draftFormSource = readFileSync("src/components/content/draft-form.tsx", "utf8");
const readinessPanelSource = readFileSync("src/components/content/generation-readiness-panel.tsx", "utf8");

const ORG = "11111111-1111-4111-a111-111111111111";
const OTHER_ORG = "22222222-2222-4222-a222-222222222222";

function profile(overrides: Partial<MarketIntelligenceProfile> = {}): MarketIntelligenceProfile {
  return {
    organisationId: ORG,
    businessObjectives: ["enquiries", "bookings"],
    targetGeographies: ["Coventry"],
    serviceAreas: ["West Midlands"],
    audienceContext: "Adults marking milestones",
    culturalContext: "Nigerian and African diaspora celebrations are in scope where relevant.",
    promotionalFocus: null,
    culturalVoiceLevel: "neutral",
    conversionActions: ["whatsapp_enquiry"],
    platformStrategy: {},
    hashtagStrategy: {},
    ...overrides,
  } as MarketIntelligenceProfile;
}

function pattern(overrides: Partial<MarketPattern>): MarketPattern {
  return {
    id: crypto.randomUUID(),
    organisationId: ORG,
    observation: "An observation.",
    category: "hook",
    platform: null,
    market: "United Kingdom",
    vertical: "Photography",
    provenance: "Test",
    confidence: 50,
    reviewedAt: new Date().toISOString(),
    isActive: true,
    ...overrides,
  } as MarketPattern;
}

describe("goal contract — no silent commercial-intent default", () => {
  it("generateCaption no longer declares a parameter default of engage", () => {
    expect(awoActionSource).not.toMatch(/commercialIntent:\s*CommercialIntent\s*=\s*"engage"/);
    expect(awoActionSource).toContain("commercialIntent?: CommercialIntent");
  });

  it("recommendCommercialIntent is deterministic and evidence-bound", () => {
    expect(recommendCommercialIntent(null)).toBe("engage");
    expect(recommendCommercialIntent(profile())).toBe("convert");
    expect(recommendCommercialIntent(profile({ conversionActions: [] }))).toBe("engage");
    expect(recommendCommercialIntent(profile({ businessObjectives: ["authority"] }))).toBe("build_trust");
    expect(recommendCommercialIntent(profile({ businessObjectives: ["community_growth"] }))).toBe("engage");
  });

  it("an explicit operator goal is never overridden and is labelled operator", async () => {
    const context = await assembleMarketGenerationContext({
      marketIntelligence: { getSnapshot: async () => ({ profile: profile(), patterns: [], references: [] }) },
      organisationId: ORG,
      platform: "instagram",
      commercialIntent: "build_trust",
    });
    expect(context.commercialIntent).toBe("build_trust");
    expect(context.commercialIntentSource).toBe("operator");
  });

  it("an absent goal resolves through the recommendation and is labelled recommended", async () => {
    const context = await assembleMarketGenerationContext({
      marketIntelligence: { getSnapshot: async () => ({ profile: profile(), patterns: [], references: [] }) },
      organisationId: ORG,
      platform: "instagram",
    });
    expect(context.commercialIntent).toBe("convert");
    expect(context.commercialIntentSource).toBe("recommended");
  });
});

describe("proof-depth pattern survives the context cap", () => {
  it("keeps the proof pattern when more than twelve patterns are active", async () => {
    const patterns = [
      ...Array.from({ length: 14 }, (_, index) => pattern({ observation: `Filler ${index}`, confidence: 90 })),
      pattern({ category: "proof", observation: "CURRENT MARKET PROOF DEPTH — matrix.", confidence: 95 }),
    ];
    const context = await assembleMarketGenerationContext({
      marketIntelligence: { getSnapshot: async () => ({ profile: profile(), patterns, references: [] }) },
      organisationId: ORG,
      platform: "instagram",
      commercialIntent: "convert",
    });
    expect(context.prompt).toContain("CURRENT MARKET PROOF DEPTH");
    expect(context.selectedPatternIds.length).toBeLessThanOrEqual(12);
  });

  it("still excludes another organisation's patterns and inactive patterns", async () => {
    const patterns = [
      pattern({ organisationId: OTHER_ORG, observation: "FOREIGN PATTERN" }),
      pattern({ isActive: false, observation: "ARCHIVED PATTERN" }),
      pattern({ observation: "OWN ACTIVE PATTERN" }),
    ];
    const context = await assembleMarketGenerationContext({
      marketIntelligence: { getSnapshot: async () => ({ profile: profile(), patterns, references: [] }) },
      organisationId: ORG,
      platform: "instagram",
      commercialIntent: "engage",
    });
    expect(context.prompt).toContain("OWN ACTIVE PATTERN");
    expect(context.prompt).not.toContain("FOREIGN PATTERN");
    expect(context.prompt).not.toContain("ARCHIVED PATTERN");
  });
});

describe("category vs entry contract in the New Draft UI", () => {
  it("the taxonomy select is no longer labelled as the content pillar", () => {
    expect(draftFormSource).toContain('label="MemBrain category"');
    expect(draftFormSource).not.toMatch(/id="categoryId"\s+label="Content pillar"/);
  });

  it("the taxonomy category label can no longer leak into the generation pillar hint", () => {
    expect(draftFormSource).not.toContain("growthPillar || draft?.category?.label");
    expect(draftFormSource).toContain("contentPillar: growthPillar || null");
  });

  it("the Growth Brief pillar options come from MemBrain entries, not categories", () => {
    expect(draftFormSource).toContain("contentPillars.map((pillar) =>");
  });

  it("the readiness panel no longer presents taxonomy as a content pillar", () => {
    expect(readinessPanelSource).toContain('label="MemBrain category emphasis"');
    expect(readinessPanelSource).not.toMatch(/id="contentPillarCategoryId"\s+label="Content pillar"/);
  });
});

describe("New Draft page pillar source", () => {
  const newDraftPage = readFileSync("src/app/(workspace)/organisations/[orgId]/content/new/page.tsx", "utf8");
  it("selects active entries from the content_pillars category only", () => {
    expect(newDraftPage).toContain('group.category.key === "content_pillars"');
    expect(newDraftPage).toContain('entry.status === "active"');
  });
});

describe("multimodal pillar selection reconciliation", () => {
  const activePillars = [
    { title: "Product education", body: "Useful product knowledge." },
    { title: "Workflow demonstration", body: "Show the workflow." },
  ];

  it("accepts an exact approved active pillar title", () => {
    expect(resolveActivePillarSelection(activePillars, "product EDUCATION")).toBe(activePillars[0]);
  });

  it("accepts Gemini echoing the approved title with its colon-delimited description", () => {
    expect(
      resolveActivePillarSelection(
        activePillars,
        "Product education: Demonstrate useful product knowledge.",
      ),
    ).toBe(activePillars[0]);
  });

  it("still rejects a model-selected pillar outside the approved active entries", () => {
    expect(resolveActivePillarSelection(activePillars, "Invented campaign pillar")).toBeNull();
  });

  it("reconciles a unique approved heading in a legacy pillar body", () => {
    const legacyPillars = [
      { title: "Additional content pillars", body: "TRANSFORMATION STORIES\n\nApproved guidance." },
      { title: "Additional content pillars", body: "EDUCATIONAL CONTENT\n\nApproved guidance." },
    ];

    expect(resolveActivePillarSelection(legacyPillars, "Transformation Stories")).toBe(legacyPillars[0]);
  });

  it("rejects ambiguous or prose-only legacy body matches", () => {
    const legacyPillars = [
      { title: "Additional content pillars", body: "SHARED HEADING\n\nTransformation stories are useful." },
      { title: "Additional content pillars", body: "SHARED HEADING\n\nOther guidance." },
    ];

    expect(resolveActivePillarSelection(legacyPillars, "Shared Heading")).toBeNull();
    expect(resolveActivePillarSelection(legacyPillars, "Transformation stories are useful.")).toBeNull();
  });
});

describe("visibility plan reaches the model prompt", () => {
  it("generateCaption injects visibilityPlanPrompt into the system prompt", () => {
    expect(awoActionSource).toContain("visibilityPlanPrompt(visibilityPlan)");
  });
});

describe("organisation access guard on every Awo generation entry point", () => {
  it("caption, rewrite and hashtags all require write access before assembling context", () => {
    expect(awoActionSource).toContain("async function requireOrgWriteAccess");
    const occurrences = awoActionSource.match(/requireOrgWriteAccess\(context, organisationId\)/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
    expect(awoActionSource).not.toContain('org?.name || "the organisation"');
  });
});

describe("honest provider failure", () => {
  it("provider failures are rethrown with their real reason, never swallowed", () => {
    expect(awoActionSource).toContain("describeProviderFailure");
    expect(draftFormSource).toContain("e instanceof Error && e.message ? e.message");
  });
});

describe("seed identity matches the launcher's verification contract", () => {
  it("seed.sql seeds the exact organisation name local-seed-verification.js enforces", () => {
    const seed = readFileSync("supabase/seed.sql", "utf8");
    // Read the verifier's expectation from its source rather than requiring the
    // CommonJS module — the contract is that both files name the same entity.
    const verifier = readFileSync("scripts/local-seed-verification.js", "utf8");
    const expectedName = verifier.match(/name:\s*'([^']+)'/)?.[1];
    const expectedId = verifier.match(/id:\s*'([^']+)'/)?.[1];
    expect(expectedName).toBeTruthy();
    expect(expectedId).toBeTruthy();
    expect(seed).toContain(`'${expectedName}'`);
    expect(seed).toContain(expectedId!);
    // A stale-name row must self-heal on re-seed, not survive DO NOTHING.
    expect(seed).toMatch(/organisations[\s\S]{0,400}ON CONFLICT \(id\) DO UPDATE SET name = EXCLUDED\.name/);
  });
});
