/**
 * Regression tests — Guided Context layer for Awo generation.
 *
 * Validates that buildGuidedContextBlock, buildCaptionSystemPrompt,
 * and buildInterpretationPreview correctly translate all 7 guided
 * context fields into system prompt content and interpretation labels.
 *
 * T1  — buildGuidedContextBlock returns null for empty context
 * T2  — topic field injected when provided
 * T3  — goal field injected when provided
 * T4  — brand_overview service treatment injected correctly
 * T5  — specific_service treatment includes service name when provided
 * T6  — specific_service treatment omits service name when absent
 * T7  — no_service_mention treatment injected correctly
 * T8  — promotion level "none" injected correctly
 * T9  — promotion level "soft" injected correctly
 * T10 — promotion level "promotional" injected correctly
 * T11 — ctaMode "auto" injected correctly
 * T12 — ctaMode "soft_enquiry" injected correctly
 * T13 — ctaMode "book" injected correctly
 * T14 — ctaMode "custom" with customCta text injected correctly
 * T15 — ctaMode "none" injected correctly
 * T16 — extraDirection field injected when provided
 * T17 — buildGuidedContextBlock includes GUIDED CONTEXT header
 * T18 — buildGuidedContextBlock includes grounding rules reminder
 * T19 — buildCaptionSystemPrompt includes guided block when guidedContext provided
 * T20 — buildCaptionSystemPrompt does not include GUIDED CONTEXT when guidedContext absent
 * T21 — MemBrain grounding rules are not overridden by guided context
 * T22 — OPERATOR REQUEST block appears before GUIDED CONTEXT in prompt
 * T23 — buildInterpretationPreview: brand general + no guided context
 * T24 — buildInterpretationPreview: campaign intent
 * T25 — buildInterpretationPreview: brand_overview + soft + soft_enquiry
 * T26 — buildInterpretationPreview: specific_service + promotional + book
 * T27 — buildInterpretationPreview: no_service_mention + none + none
 * T28 — buildInterpretationPreview always ends with MemBrain
 */

import { describe, expect, it } from "vitest";
import {
  buildGuidedContextBlock,
  buildCaptionSystemPrompt,
  type AwoMembrainContext,
  type GenerationGuidedContext,
} from "@/server/actions/awo-grounding";
import { buildInterpretationPreview } from "@/components/content/awo-assist-logic";

// ─── fixtures ─────────────────────────────────────────────────────────────────

const BASE_CTX: AwoMembrainContext = {
  brandVoice: ["Premium, warm, and expert."],
  targetAudience: ["Clients seeking professional styling."],
  brandDescription: ["A full-service beauty studio."],
  productsAndServices: ["Wig installation", "Bridal makeup"],
  contentPillars: ["Client transformations"],
  restrictions: [],
};

const FULL_GUIDED: GenerationGuidedContext = {
  topic: "Welcome to August",
  goal: "Build community warmth",
  serviceTreatment: "brand_overview",
  promotionLevel: "soft",
  ctaMode: "soft_enquiry",
  extraDirection: "Keep it under 150 words",
};

// ─── T1: empty context returns null ──────────────────────────────────────────

describe("T1 — buildGuidedContextBlock returns null for an empty context object", () => {
  it("empty object → null", () => {
    expect(buildGuidedContextBlock({})).toBeNull();
  });

  it("object with only undefined values → null", () => {
    expect(buildGuidedContextBlock({ topic: undefined, goal: undefined })).toBeNull();
  });
});

// ─── T2: topic field ─────────────────────────────────────────────────────────

describe("T2 — topic field is injected when provided", () => {
  it("block contains 'Topic: Welcome to August'", () => {
    const block = buildGuidedContextBlock({ topic: "Welcome to August" });
    expect(block).toContain("Topic: Welcome to August");
  });

  it("block is non-null when only topic is set", () => {
    expect(buildGuidedContextBlock({ topic: "Test" })).not.toBeNull();
  });
});

// ─── T3: goal field ──────────────────────────────────────────────────────────

describe("T3 — goal field is injected when provided", () => {
  it("block contains 'Goal: Build community warmth'", () => {
    const block = buildGuidedContextBlock({ goal: "Build community warmth" });
    expect(block).toContain("Goal: Build community warmth");
  });
});

// ─── T4: brand_overview treatment ────────────────────────────────────────────

describe("T4 — brand_overview service treatment injected correctly", () => {
  it("block contains 'Brand overview'", () => {
    const block = buildGuidedContextBlock({ serviceTreatment: "brand_overview" });
    expect(block?.toLowerCase()).toContain("brand overview");
  });
});

// ─── T5: specific_service with name ──────────────────────────────────────────

describe("T5 — specific_service treatment includes service name when provided", () => {
  it("block contains the specific service name", () => {
    const block = buildGuidedContextBlock({ serviceTreatment: "specific_service", specificService: "Bridal makeup" });
    expect(block).toContain("Bridal makeup");
  });
});

// ─── T6: specific_service without name ───────────────────────────────────────

describe("T6 — specific_service treatment omits service name line when not provided", () => {
  it("no 'Specific service:' line when specificService is absent", () => {
    const block = buildGuidedContextBlock({ serviceTreatment: "specific_service" });
    expect(block).not.toContain("Specific service:");
  });
});

// ─── T7: no_service_mention treatment ────────────────────────────────────────

describe("T7 — no_service_mention treatment injected correctly", () => {
  it("block contains service-neutral instruction", () => {
    const block = buildGuidedContextBlock({ serviceTreatment: "no_service_mention" });
    expect(block?.toLowerCase()).toContain("service-neutral");
  });
});

// ─── T8–T10: promotion levels ────────────────────────────────────────────────

describe("T8 — promotion level 'none' injected correctly", () => {
  it("block contains 'no commercial promotion'", () => {
    const block = buildGuidedContextBlock({ promotionLevel: "none" });
    expect(block?.toLowerCase()).toContain("no commercial promotion");
  });
});

describe("T9 — promotion level 'soft' injected correctly", () => {
  it("block contains 'soft' promotion instruction", () => {
    const block = buildGuidedContextBlock({ promotionLevel: "soft" });
    expect(block?.toLowerCase()).toContain("soft");
  });
});

describe("T10 — promotion level 'promotional' injected correctly", () => {
  it("block contains 'promotional' instruction", () => {
    const block = buildGuidedContextBlock({ promotionLevel: "promotional" });
    expect(block?.toLowerCase()).toContain("promotional");
  });
});

// ─── T11–T15: CTA modes ──────────────────────────────────────────────────────

describe("T11 — ctaMode 'auto' injected correctly", () => {
  it("block contains 'auto' CTA instruction", () => {
    const block = buildGuidedContextBlock({ ctaMode: "auto" });
    expect(block?.toLowerCase()).toContain("auto");
  });
});

describe("T12 — ctaMode 'soft_enquiry' injected correctly", () => {
  it("block contains soft enquiry instruction", () => {
    const block = buildGuidedContextBlock({ ctaMode: "soft_enquiry" });
    expect(block?.toLowerCase()).toContain("enquir");
  });
});

describe("T13 — ctaMode 'book' injected correctly", () => {
  it("block contains booking invitation instruction", () => {
    const block = buildGuidedContextBlock({ ctaMode: "book" });
    expect(block?.toLowerCase()).toContain("book");
  });
});

describe("T14 — ctaMode 'custom' with customCta text injected correctly", () => {
  it("block contains the custom CTA text", () => {
    const block = buildGuidedContextBlock({ ctaMode: "custom", customCta: "Sign up now" });
    expect(block).toContain("Sign up now");
  });

  it("block contains 'Custom' label", () => {
    const block = buildGuidedContextBlock({ ctaMode: "custom", customCta: "Sign up now" });
    expect(block).toContain("Custom");
  });
});

describe("T15 — ctaMode 'none' injected correctly", () => {
  it("block contains 'do not include' or 'none' CTA instruction", () => {
    const block = buildGuidedContextBlock({ ctaMode: "none" });
    expect(block?.toLowerCase()).toMatch(/none|do not include a call to action/);
  });
});

// ─── T16: extraDirection ─────────────────────────────────────────────────────

describe("T16 — extraDirection field injected when provided", () => {
  it("block contains the extra direction text", () => {
    const block = buildGuidedContextBlock({ extraDirection: "Keep it under 150 words" });
    expect(block).toContain("Keep it under 150 words");
  });
});

// ─── T17: GUIDED CONTEXT header ──────────────────────────────────────────────

describe("T17 — buildGuidedContextBlock includes GUIDED CONTEXT header", () => {
  it("block starts with or contains the section header", () => {
    const block = buildGuidedContextBlock(FULL_GUIDED);
    expect(block).toContain("=== GUIDED CONTEXT ===");
  });
});

// ─── T18: grounding rules reminder ───────────────────────────────────────────

describe("T18 — buildGuidedContextBlock includes grounding rules reminder", () => {
  it("block states guided context must not authorise invention of facts", () => {
    const block = buildGuidedContextBlock(FULL_GUIDED);
    expect(block?.toLowerCase()).toMatch(/must never authorise invention|invention of facts/);
  });

  it("block states MemBrain rules remain authoritative", () => {
    const block = buildGuidedContextBlock(FULL_GUIDED);
    expect(block?.toLowerCase()).toContain("membrain");
  });
});

// ─── T19: guided block injected into buildCaptionSystemPrompt ─────────────────

describe("T19 — buildCaptionSystemPrompt includes guided block when guidedContext provided", () => {
  it("system prompt contains GUIDED CONTEXT section", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", BASE_CTX, "brand_general", "Welcome", FULL_GUIDED);
    expect(prompt).toContain("=== GUIDED CONTEXT ===");
  });

  it("system prompt contains topic from guided context", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", BASE_CTX, "brand_general", "Welcome", FULL_GUIDED);
    expect(prompt).toContain("Topic: Welcome to August");
  });
});

// ─── T20: guided block absent when no guidedContext ──────────────────────────

describe("T20 — buildCaptionSystemPrompt does not include GUIDED CONTEXT when guidedContext absent", () => {
  it("no GUIDED CONTEXT section when guidedContext is undefined", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", BASE_CTX, "brand_general", "Welcome");
    expect(prompt).not.toContain("=== GUIDED CONTEXT ===");
  });
});

// ─── T21: MemBrain grounding not overridden ───────────────────────────────────

describe("T21 — MemBrain grounding rules are not overridden by guided context", () => {
  it("factual grounding rule still present when guided context is provided", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", BASE_CTX, "brand_general", "Welcome", FULL_GUIDED);
    expect(prompt.toLowerCase()).toContain("directly supported by the membrain context");
  });

  it("brand voice still present when guided context is provided", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", BASE_CTX, "brand_general", "Welcome", FULL_GUIDED);
    expect(prompt).toContain("Premium, warm, and expert.");
  });
});

// ─── T22: prompt block order ─────────────────────────────────────────────────

describe("T22 — OPERATOR REQUEST block appears before GUIDED CONTEXT in system prompt", () => {
  it("operator request index is less than guided context index", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", BASE_CTX, "brand_general", "Welcome", FULL_GUIDED);
    const opIdx = prompt.indexOf("=== OPERATOR REQUEST ===");
    const gcIdx = prompt.indexOf("=== GUIDED CONTEXT ===");
    expect(opIdx).toBeGreaterThan(-1);
    expect(gcIdx).toBeGreaterThan(-1);
    expect(opIdx).toBeLessThan(gcIdx);
  });
});

// ─── T23–T28: buildInterpretationPreview ─────────────────────────────────────

describe("T23 — buildInterpretationPreview: brand general with no guided context", () => {
  it("includes 'Brand General' and 'MemBrain'", () => {
    const preview = buildInterpretationPreview(false);
    expect(preview).toContain("Brand General");
    expect(preview).toContain("MemBrain");
  });
});

describe("T24 — buildInterpretationPreview: campaign intent", () => {
  it("includes 'Campaign' when hasCampaign is true", () => {
    const preview = buildInterpretationPreview(true);
    expect(preview).toContain("Campaign");
    expect(preview).not.toContain("Brand General");
  });
});

describe("T25 — buildInterpretationPreview: brand_overview + soft + soft_enquiry", () => {
  it("includes all three labels", () => {
    const preview = buildInterpretationPreview(false, {
      serviceTreatment: "brand_overview",
      promotionLevel: "soft",
      ctaMode: "soft_enquiry",
    });
    expect(preview).toContain("Brand Overview");
    expect(preview).toContain("Soft Promotion");
    expect(preview).toContain("Soft Enquiry");
  });
});

describe("T26 — buildInterpretationPreview: specific_service + promotional + book", () => {
  it("includes all three labels", () => {
    const preview = buildInterpretationPreview(false, {
      serviceTreatment: "specific_service",
      promotionLevel: "promotional",
      ctaMode: "book",
    });
    expect(preview).toContain("Service Focus");
    expect(preview).toContain("Promotional");
    expect(preview).toContain("Booking CTA");
  });
});

describe("T27 — buildInterpretationPreview: no_service_mention + none + none", () => {
  it("includes all three labels", () => {
    const preview = buildInterpretationPreview(false, {
      serviceTreatment: "no_service_mention",
      promotionLevel: "none",
      ctaMode: "none",
    });
    expect(preview).toContain("Service-Neutral");
    expect(preview).toContain("No Promotion");
    expect(preview).toContain("No CTA");
  });
});

describe("T28 — buildInterpretationPreview always ends with MemBrain", () => {
  const cases: [boolean, GenerationGuidedContext | undefined][] = [
    [false, undefined],
    [true, undefined],
    [false, FULL_GUIDED],
    [true, { serviceTreatment: "specific_service", ctaMode: "book" }],
  ];
  for (const [hasCampaign, ctx] of cases) {
    it(`hasCampaign=${hasCampaign} ctx=${ctx ? "present" : "absent"} → ends with MemBrain`, () => {
      const preview = buildInterpretationPreview(hasCampaign, ctx);
      expect(preview.endsWith("MemBrain")).toBe(true);
    });
  }
});
