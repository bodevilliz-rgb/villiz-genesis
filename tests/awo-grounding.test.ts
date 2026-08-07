/**
 * AWO AI Assist grounding and compliance tests.
 *
 * Tests are grounded in the Mervic production failure:
 *   MemBrain only supports:
 *     "Luxury Wig Installation provides a natural-looking finish and
 *      prioritises healthy natural hair."
 *
 *   The AI invented organisation-specific claims not present in MemBrain:
 *     - precision plucking
 *     - lace melting
 *     - expert tinting
 *     - braid-down method
 *     - custom hairline design
 *
 *   Rules prohibited "Perfect" / "Perfection" / "Perfectly" but the AI
 *   used lexical variants and the violation was not caught.
 *
 * These tests verify the pure functions (no I/O) — the system prompt
 * content, the compliance detector, and the compliance repair gate.
 */

import { describe, expect, it } from "vitest";

import {
  extractAwoMembrainContext,
  buildCaptionSystemPrompt,
  buildRewriteSystemPrompt,
  type AwoMembrainContext,
} from "@/server/actions/awo-grounding";
import {
  extractProhibitedTerms,
  detectComplianceViolations,
  repairComplianceViolations,
} from "@/core/application/use-cases/generation/compliance";
import type { MembrainOverview } from "@/core/application/use-cases/membrain";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Mervic-style MemBrain: one service entry, a "Perfect" restriction, no booking channel. */
function makeMembrainOverview(overrides: Partial<{
  brandVoiceEntries: string[];
  audienceEntries: string[];
  brandDescriptionEntries: string[];
  offeringEntries: string[];
  contentPillarEntries: string[];
  guidelinesEntries: string[];
  bookingChannelEntry: string | null;
}>): MembrainOverview {
  const {
    brandVoiceEntries = ["Warm, expert, and confidence-inspiring."],
    audienceEntries = ["Women seeking natural-looking hair solutions."],
    brandDescriptionEntries = [],
    offeringEntries = ["Luxury Wig Installation provides a natural-looking finish and prioritises healthy natural hair."],
    contentPillarEntries = [],
    guidelinesEntries = ["Never use the word 'Perfect', 'Perfection' or 'Perfectly'."],
    bookingChannelEntry = null,
  } = overrides;

  const makeCategory = (id: string, key: string, label: string) => ({
    id,
    organisationId: "org-mervic",
    key,
    label,
    description: null,
    position: 0,
    isSystem: true,
  });
  const makeEntry = (id: string, categoryKey: string, categoryId: string, body: string) => ({
    id,
    organisationId: "org-mervic",
    categoryId,
    title: body.slice(0, 30),
    summary: null,
    body,
    status: "active" as const,
    source: "manual" as const,
    sourceUrl: null,
    importance: 2,
    version: 1,
    retrievalCount: 0,
    lastRetrievedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null,
    category: { id: categoryId, key: categoryKey, label: "Test" },
    tags: [],
  });

  const categories = [
    makeCategory("cat-bv", "brand_voice", "Brand Voice & Positioning"),
    makeCategory("cat-au", "audience", "Target Audience"),
    makeCategory("cat-bd", "brand_description", "Brand Description"),
    makeCategory("cat-of", "offering", "Products & Services"),
    makeCategory("cat-cp", "content_pillars", "Content Pillars"),
    makeCategory("cat-gl", "guidelines", "Rules & Compliance"),
  ];

  const allEntries = [
    ...brandVoiceEntries.map((b, i) => makeEntry(`bv-${i}`, "brand_voice", "cat-bv", b)),
    ...audienceEntries.map((b, i) => makeEntry(`au-${i}`, "audience", "cat-au", b)),
    ...brandDescriptionEntries.map((b, i) => makeEntry(`bd-${i}`, "brand_description", "cat-bd", b)),
    ...offeringEntries.map((b, i) => makeEntry(`of-${i}`, "offering", "cat-of", b)),
    ...contentPillarEntries.map((b, i) => makeEntry(`cp-${i}`, "content_pillars", "cat-cp", b)),
    ...guidelinesEntries.map((b, i) => makeEntry(`gl-${i}`, "guidelines", "cat-gl", b)),
    ...(bookingChannelEntry
      ? [makeEntry("bv-booking", "brand_voice", "cat-bv", bookingChannelEntry)]
      : []),
  ];

  const groups = categories.map((category) => ({
    category,
    entries: allEntries.filter((e) => e.category?.id === category.id),
  }));

  return {
    totalEntries: allEntries.length,
    categories,
    groups,
    uncategorised: [],
    readiness: {
      percentage: 60,
      metCount: 3,
      totalSignals: 6,
      signals: [],
      missingAreas: [],
    },
  };
}

const MERVIC_CTX: AwoMembrainContext = {
  brandVoice: ["Warm, expert, and confidence-inspiring."],
  targetAudience: ["Women seeking natural-looking hair solutions."],
  brandDescription: [],
  productsAndServices: [
    "Luxury Wig Installation provides a natural-looking finish and prioritises healthy natural hair.",
  ],
  contentPillars: [],
  restrictions: ["Never use the word 'Perfect', 'Perfection' or 'Perfectly'."],
};

const NO_BOOKING_CTX: AwoMembrainContext = {
  ...MERVIC_CTX,
  productsAndServices: ["Luxury Wig Installation — available by appointment."],
};

const WITH_BOOKING_CTX: AwoMembrainContext = {
  ...MERVIC_CTX,
  productsAndServices: [
    "Book your Luxury Wig Installation via WhatsApp at +44 7700 900000.",
  ],
};

// ---------------------------------------------------------------------------
// Test 1 — extractAwoMembrainContext: key-based extraction of all 6 categories
// ---------------------------------------------------------------------------
describe("extractAwoMembrainContext", () => {
  it("extracts all six categories using key-based lookup", () => {
    const membrain = makeMembrainOverview({});
    const ctx = extractAwoMembrainContext(membrain);
    expect(ctx.brandVoice).toHaveLength(1);
    expect(ctx.targetAudience).toHaveLength(1);
    expect(ctx.productsAndServices).toHaveLength(1);
    expect(ctx.restrictions).toHaveLength(1);
  });

  it("only includes active entries — draft and archived are excluded", () => {
    const membrain = makeMembrainOverview({});
    // Inject a draft entry into the guidelines group
    const guidelinesGroup = membrain.groups.find((g) => g.category.key === "guidelines")!;
    guidelinesGroup.entries.push({
      ...guidelinesGroup.entries[0]!,
      id: "gl-draft",
      status: "draft",
      body: "Draft restriction — must not appear.",
    });

    const ctx = extractAwoMembrainContext(membrain);
    const draftInContext = ctx.restrictions.some((r) => r.includes("Draft restriction"));
    expect(draftInContext).toBe(false);
  });

  it("returns empty arrays when a category has no active entries", () => {
    const membrain = makeMembrainOverview({ brandDescriptionEntries: [] });
    const ctx = extractAwoMembrainContext(membrain);
    expect(ctx.brandDescription).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — buildCaptionSystemPrompt: Mervic failure — unsupported claims prohibited
// ---------------------------------------------------------------------------
describe("buildCaptionSystemPrompt — Mervic grounding failure", () => {
  it("includes the MemBrain service entry verbatim in the system prompt", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", MERVIC_CTX);
    expect(prompt).toContain("Luxury Wig Installation provides a natural-looking finish");
  });

  it("includes the factual grounding rule prohibiting invented claims", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", MERVIC_CTX);
    const lower = prompt.toLowerCase();
    expect(lower).toContain("never invent");
    expect(lower).toContain("techniques");
    expect(lower).toContain("service processes");
  });

  it("prohibits invention of specific unsupported claim types (Mervic inventory)", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", MERVIC_CTX);
    const lower = prompt.toLowerCase();
    // The grounding rule must explicitly name the categories of things that cannot be invented
    expect(lower).toMatch(/prices|durations|guarantees|qualifications|outcomes/);
  });

  it("requires claims to be directly supported by MemBrain context", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", MERVIC_CTX);
    const lower = prompt.toLowerCase();
    expect(lower).toContain("directly supported");
    expect(lower).toContain("membrain context");
  });

  it("permits faithful paraphrasing", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", MERVIC_CTX);
    expect(prompt.toLowerCase()).toContain("faithful paraphrasing is allowed");
  });

  it("permits creative hooks and emotional language", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", MERVIC_CTX);
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/hooks|transitions|emotional language/);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — buildCaptionSystemPrompt: CTA / booking channel grounding
// ---------------------------------------------------------------------------
describe("buildCaptionSystemPrompt — booking channel grounding", () => {
  it("prohibits specific booking CTAs when no channel is in MemBrain context", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", NO_BOOKING_CTX);
    const lower = prompt.toLowerCase();
    expect(lower).toContain("dm us");
    expect(lower).toContain("link in bio");
    expect(lower).toContain("whatsapp us");
    expect(lower).toContain("call us");
    expect(lower).toContain("email us");
    expect(lower).toContain("visit our website");
  });

  it("includes the generic CTA fallback instruction when no booking channel exists", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", NO_BOOKING_CTX);
    expect(prompt.toLowerCase()).toContain("book your appointment");
  });

  it("includes the MemBrain context so the AI can reference an explicit booking channel", () => {
    const prompt = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", WITH_BOOKING_CTX);
    // WhatsApp booking is in the MemBrain context — the AI can see and use it
    expect(prompt).toContain("Book your Luxury Wig Installation via WhatsApp at +44 7700 900000");
  });

  it("includes the CTA restriction rule regardless of booking channel presence", () => {
    const promptWith = buildCaptionSystemPrompt("Mervic Beauty", "Instagram", WITH_BOOKING_CTX);
    expect(promptWith.toLowerCase()).toContain("explicitly stated in the membrain context");
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Compliance: "Perfect" variants detected case-insensitively
// ---------------------------------------------------------------------------
describe("compliance — 'Perfect' variant detection (Mervic restriction)", () => {
  const restrictions = ["Never use the word 'Perfect', 'Perfection' or 'Perfectly'."];

  it("extracts all three quoted variants as prohibited terms", () => {
    const terms = extractProhibitedTerms(restrictions);
    expect(terms).toContain("perfect");
    expect(terms).toContain("perfection");
    expect(terms).toContain("perfectly");
  });

  it("detects 'perfectly' in generated copy (lowercase)", () => {
    const violations = detectComplianceViolations(
      "Enjoy a perfectly natural-looking finish.",
      restrictions,
    );
    expect(violations).toContain("perfectly");
  });

  it("detects 'Perfect' in generated copy (capitalised)", () => {
    const violations = detectComplianceViolations(
      "The Perfect Finish awaits you.",
      restrictions,
    );
    expect(violations).toContain("perfect");
  });

  it("detects 'PERFECTION' in generated copy (upper case)", () => {
    const violations = detectComplianceViolations(
      "Absolute PERFECTION for your hair.",
      restrictions,
    );
    expect(violations).toContain("perfection");
  });

  it("does not flag copy that uses none of the prohibited terms", () => {
    const violations = detectComplianceViolations(
      "Enjoy a beautifully natural-looking finish with Luxury Wig Installation.",
      restrictions,
    );
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Compliance repair: coherence gate
// ---------------------------------------------------------------------------
describe("compliance repair — coherence gate", () => {
  const restrictions = ["Never use 'cheap'."];

  it("safely repairs a violation when the output remains coherent", () => {
    const result = repairComplianceViolations(
      "Our affordable and cheap wig installations are available now.",
      ["cheap"],
    );
    expect(result.safe).toBe(true);
    expect(result.body.toLowerCase()).not.toContain("cheap");
    expect(result.requiresReview).toBe(false);
  });

  it("returns safe:false and the original body when repair would produce incoherent copy", () => {
    // Removing the only word leaves only punctuation
    const original = "cheap!";
    const result = repairComplianceViolations(original, ["cheap"]);
    expect(result.safe).toBe(false);
    expect(result.requiresReview).toBe(true);
    expect(result.body).toBe(original);
  });

  it("returns safe:false when removal creates a leading comma", () => {
    const result = repairComplianceViolations("cheap, affordable options.", ["cheap"]);
    expect(result.safe).toBe(false);
    expect(result.requiresReview).toBe(true);
  });

  it("collapses whitespace in safe repairs", () => {
    const result = repairComplianceViolations("We offer cheap  solutions.", ["cheap"]);
    expect(result.safe).toBe(true);
    expect(result.body).not.toMatch(/\s{2,}/);
  });

  it("returns the original body unchanged with safe:true when no violations", () => {
    const original = "Enjoy our luxury wig installation service.";
    const result = repairComplianceViolations(original, []);
    expect(result.safe).toBe(true);
    expect(result.body).toBe(original);
    void restrictions; // suppress unused variable
  });
});

// ---------------------------------------------------------------------------
// Test 6 — buildRewriteSystemPrompt: factual grounding on rewrites
// ---------------------------------------------------------------------------
describe("buildRewriteSystemPrompt — factual grounding", () => {
  it("includes the factual grounding rule", () => {
    const prompt = buildRewriteSystemPrompt("Mervic Beauty", "Rewrite this to be punchy.", MERVIC_CTX);
    expect(prompt.toLowerCase()).toContain("directly supported by the membrain context");
  });

  it("prohibits adding new factual claims during rewriting", () => {
    const prompt = buildRewriteSystemPrompt("Mervic Beauty", "Rewrite this to be punchy.", MERVIC_CTX);
    expect(prompt.toLowerCase()).toContain("do not add");
  });

  it("includes brand voice context", () => {
    const prompt = buildRewriteSystemPrompt("Mervic Beauty", "Rewrite this to be punchy.", MERVIC_CTX);
    expect(prompt).toContain("Warm, expert, and confidence-inspiring.");
  });

  it("includes restrictions context", () => {
    const prompt = buildRewriteSystemPrompt("Mervic Beauty", "Rewrite this to be punchy.", MERVIC_CTX);
    expect(prompt).toContain("Never use the word 'Perfect'");
  });
});
