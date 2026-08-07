/**
 * Task H — Grounding hardening tests (revised per review corrections).
 *
 * Tests A–C cover the pure compliance module (no I/O).
 * Test D covers the category-mismatch heuristic (no I/O).
 * Test E covers STANDING_PRINCIPLES in the Prompt Composer.
 * Test F covers the paraphrasing / grounding rules specifically.
 */
import { describe, expect, it } from "vitest";

import {
  detectComplianceViolations,
  extractProhibitedTerms,
  repairComplianceViolations,
} from "@/core/application/use-cases/generation/compliance";
import { detectCategoryMismatches } from "@/core/application/use-cases/membrain/category-mismatch";
import { composePromptSpecification } from "@/core/application/use-cases/generation/prompt-composer";
import type { GenerationContext } from "@/core/domain/entities/generation";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_CONTEXT: GenerationContext = {
  organisation: { id: "org-1", name: "Acme Co", industry: "Retail", websiteUrl: null },
  campaign: null,
  brand: {
    brandDescription: ["Acme is a boutique retail store."],
    brandVoice: ["Friendly and approachable."],
    targetAudience: ["Women aged 25-40 interested in sustainable fashion."],
    contentPillars: ["Sustainable fashion", "Style tips"],
    productsAndServices: ["Eco handbags from $49"],
    restrictions: ["Never use the word 'cheap'.", "Do not claim 'free shipping' unless confirmed."],
  },
  draft: {
    id: "draft-1",
    contentType: "social_post",
    status: "draft",
    title: "Our summer collection",
    body: "Check out our amazing summer styles!",
    summary: null,
    category: null,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  requestedBy: { id: "user-1", fullName: "Alice", email: "alice@acme.com" },
  assembledAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Test A — extractProhibitedTerms: only extracts from prohibition sentences
// ---------------------------------------------------------------------------
describe("extractProhibitedTerms", () => {
  it("extracts quoted terms from prohibition sentences", () => {
    const restrictions = [
      "Never use the word 'cheap', 'bargain', or 'dirt cheap'.",
      "Always be professional.",
      "Do not use 'free shipping' unless confirmed.",
    ];
    const terms = extractProhibitedTerms(restrictions);
    expect(terms).toContain("cheap");
    expect(terms).toContain("bargain");
    expect(terms).toContain("dirt cheap");
    expect(terms).toContain("free shipping");
  });

  it("ignores non-prohibition sentences", () => {
    const terms = extractProhibitedTerms(["Be consistent with the 'bold' aesthetic."]);
    expect(terms).toHaveLength(0);
  });

  it("de-duplicates terms across multiple restrictions", () => {
    const restrictions = [
      "Never use 'cheap'.",
      "Avoid 'cheap' pricing language.",
    ];
    const terms = extractProhibitedTerms(restrictions);
    expect(terms.filter((t) => t === "cheap")).toHaveLength(1);
  });

  it("returns empty array when restrictions is empty", () => {
    expect(extractProhibitedTerms([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test B — detectComplianceViolations: finds prohibited terms in body text
// ---------------------------------------------------------------------------
describe("detectComplianceViolations", () => {
  it("detects a prohibited term present in the body", () => {
    const restrictions = ["Never use the word 'cheap'."];
    const body = "Get our cheap bags today!";
    const violations = detectComplianceViolations(body, restrictions);
    expect(violations).toContain("cheap");
  });

  it("returns empty when no prohibited terms appear", () => {
    const restrictions = ["Never use the word 'cheap'."];
    const body = "Get our affordable bags today!";
    expect(detectComplianceViolations(body, restrictions)).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const restrictions = ["Never use 'Cheap'."];
    const body = "Super CHEAP deals!";
    const violations = detectComplianceViolations(body, restrictions);
    expect(violations).toContain("cheap");
  });

  it("is case-insensitive for mixed-case body text", () => {
    const restrictions = ["Never use 'bargain'."];
    const body = "Amazing Bargain prices available now.";
    const violations = detectComplianceViolations(body, restrictions);
    expect(violations).toContain("bargain");
  });

  it("does not flag body text when restrictions have no prohibition trigger", () => {
    const restrictions = ["Be consistent with the brand voice."];
    const body = "Great consistent brand voice content.";
    expect(detectComplianceViolations(body, restrictions)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test C — repairComplianceViolations: safe coherence-gated removal
// ---------------------------------------------------------------------------
describe("repairComplianceViolations", () => {
  it("removes a single prohibited term and returns safe:true for coherent output", () => {
    const result = repairComplianceViolations("Our cheap bags are here.", ["cheap"]);
    expect(result.safe).toBe(true);
    expect(result.requiresReview).toBe(false);
    expect(result.body.toLowerCase()).not.toContain("cheap");
  });

  it("removes multiple prohibited terms and returns safe:true when output is coherent", () => {
    const result = repairComplianceViolations(
      "Discover affordable bags. Cheap bargain deals for everyone.",
      ["cheap", "bargain"],
    );
    expect(result.safe).toBe(true);
    expect(result.body.toLowerCase()).not.toContain("cheap");
    expect(result.body.toLowerCase()).not.toContain("bargain");
  });

  it("returns the original body and safe:true when violations list is empty", () => {
    const original = "Our affordable bags are here.";
    const result = repairComplianceViolations(original, []);
    expect(result.body).toBe(original);
    expect(result.safe).toBe(true);
    expect(result.requiresReview).toBe(false);
  });

  it("collapses extra whitespace after removal in safe repairs", () => {
    const result = repairComplianceViolations("We offer cheap  options.", ["cheap"]);
    expect(result.safe).toBe(true);
    expect(result.body).not.toMatch(/\s{2,}/);
  });

  it("returns safe:false and requiresReview:true when repair produces incoherent copy", () => {
    // Removing the only word leaves only punctuation — incoherent
    const result = repairComplianceViolations("cheap!", ["cheap"]);
    expect(result.safe).toBe(false);
    expect(result.requiresReview).toBe(true);
  });

  it("preserves the original body (unmodified) when repair is unsafe", () => {
    const original = "cheap!";
    const result = repairComplianceViolations(original, ["cheap"]);
    expect(result.safe).toBe(false);
    // Must return original, not the damaged "!" string
    expect(result.body).toBe(original);
  });

  it("flags as unsafe when removal leaves a leading comma", () => {
    // "cheap, bags are great" → ", bags are great" → starts with comma
    const result = repairComplianceViolations("cheap, bags are great.", ["cheap"]);
    expect(result.safe).toBe(false);
    expect(result.requiresReview).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test D — detectCategoryMismatches: heuristic keyword detection
// ---------------------------------------------------------------------------
describe("detectCategoryMismatches", () => {
  it("flags an audience entry stored under brand_voice", () => {
    const entries = [
      {
        id: "entry-1",
        title: "Target Audience Overview",
        body: "Our target audience is women aged 25-40 with a buyer persona focused on sustainability. They are a key customer segment.",
        categoryKey: "brand_voice",
      },
    ];
    const warnings = detectCategoryMismatches(entries);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.suggestedCategoryKey).toBe("audience");
    expect(warnings[0]!.currentCategoryKey).toBe("brand_voice");
  });

  it("does not flag an entry correctly stored in its category", () => {
    const entries = [
      {
        id: "entry-2",
        title: "Brand Voice Guide",
        body: "Our tone of voice is friendly and conversational. Always write in a casual style.",
        categoryKey: "brand_voice",
      },
    ];
    expect(detectCategoryMismatches(entries)).toHaveLength(0);
  });

  it("does not flag entries with only one keyword hit (below threshold)", () => {
    const entries = [
      {
        id: "entry-3",
        title: "Company overview",
        body: "We serve customers across the region.",
        categoryKey: "brand_description",
      },
    ];
    expect(detectCategoryMismatches(entries)).toHaveLength(0);
  });

  it("returns an empty array for an empty entry list", () => {
    expect(detectCategoryMismatches([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test E — STANDING_PRINCIPLES: grounding rules are present in the spec
// ---------------------------------------------------------------------------
describe("composePromptSpecification grounding principles", () => {
  it("includes a principle that prohibits fabricating factual claims", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    const joined = spec.systemContext.principles.join(" ").toLowerCase();
    expect(joined).toContain("never fabricate");
  });

  it("includes a principle that references the brand context as the factual source", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    const joined = spec.systemContext.principles.join(" ").toLowerCase();
    expect(joined).toContain("brand context");
  });

  it("includes a principle that prohibits using industry norms as a substitute", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    const joined = spec.systemContext.principles.join(" ").toLowerCase();
    expect(joined).toMatch(/industry|generalise|norm/);
  });

  it("includes a principle that permits structural improvements", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    const joined = spec.systemContext.principles.join(" ").toLowerCase();
    expect(joined).toMatch(/clarity|structure|grammar|flow/);
  });

  it("passes brand restrictions through to the constraints array", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    expect(spec.constraints).toEqual(BASE_CONTEXT.brand.restrictions);
  });
});

// ---------------------------------------------------------------------------
// Test F — Paraphrasing / grounding boundary rules
// ---------------------------------------------------------------------------
describe("STANDING_PRINCIPLES paraphrasing and grounding boundary", () => {
  it("explicitly permits faithful paraphrasing of brand context", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    const joined = spec.systemContext.principles.join(" ").toLowerCase();
    expect(joined).toContain("faithful paraphrasing is allowed");
  });

  it("requires paraphrasing to not introduce new facts", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    const joined = spec.systemContext.principles.join(" ").toLowerCase();
    // The paraphrasing rule must bound what is permitted
    expect(joined).toMatch(/introduce|strengthen|quantify|materially alter/);
  });

  it("requires claims to be directly supported by brand context, not just plausible", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    const joined = spec.systemContext.principles.join(" ").toLowerCase();
    expect(joined).toContain("directly supported");
  });

  it("prohibits new factual claims in structural improvements", () => {
    const spec = composePromptSpecification(BASE_CONTEXT);
    const joined = spec.systemContext.principles.join(" ").toLowerCase();
    // Improvement principle must explicitly bound new factual claims
    expect(joined).toContain("no new factual claim");
  });
});
