/**
 * Regression tests — Explicit subject preservation in generation.
 *
 * Root cause:
 *   buildCaptionSystemPrompt had no instruction naming the operator's prompt as
 *   the PRIMARY SEMANTIC ANCHOR.  The brand_general intent block told the model
 *   what NOT to do (do not pick a service) but not what the content MUST be
 *   about.  With rich MemBrain brand context and no subject anchor, the model
 *   pattern-matched on brand identity and produced aspirational template copy
 *   ("True elegance begins with feeling completely yourself") instead of
 *   fulfilling the operator's specific request ("Welcome to August").
 *
 *   Two compounding factors:
 *     a. The CTA fallback ("use 'Book your appointment'") was mandatory rather
 *        than conditional — causing booking CTAs on greeting posts.
 *     b. The factual-inference prohibition did not name occasions/events, so
 *        the model freely invented an "upcoming occasion" framing.
 *
 * Fix (awo-grounding.ts only; awo.ts: one-line change to pass prompt):
 *   1. buildCaptionSystemPrompt now accepts operatorPrompt? (5th param) and
 *      injects an === OPERATOR REQUEST === block naming the prompt as the
 *      primary anchor.
 *   2. brand_general intent block now states the operator's request is the
 *      primary subject; MemBrain defines HOW, not WHAT.
 *   3. GROUNDING_RULES CTA section is now conditional — greetings and
 *      appreciation posts do not require a booking CTA.
 *   4. GROUNDING_RULES factual inference prohibition now covers invented
 *      occasions, events, deadlines and assumed client needs.
 *
 * T1  — "Welcome to August" → brand_general intent
 * T2  — system prompt with operatorPrompt injects explicit subject anchor block
 * T3  — subject anchor block contains the operator's prompt text verbatim
 * T4  — CTA section is conditional (not mandatory for all post types)
 * T5  — factual inference prohibition now covers invented occasions and client needs
 * T6  — "Thank you to our clients" → brand_general intent
 * T7  — appreciation prompt system prompt preserves subject via anchor block
 * T8  — "Happy Mother's Day" → brand_general intent
 * T9  — "Celebrate our anniversary" → brand_general intent
 * T10 — brand_general intent block states operator request is the primary subject
 * T11 — explicit service request remains service_specific (regression)
 * T12 — educational request remains educational (regression)
 * T13 — campaign with hasCampaign overrides intent (regression)
 * T14 — brand voice still present in every generated prompt (regression)
 * T15 — factual grounding rule still present in every generated prompt (regression)
 * T16 — Products & Services section still present in every generated prompt (regression)
 * T17 — brand_general instruction treats service reference as optional, not required
 * T18 — buildRewriteSystemPrompt is not affected by the subject-anchor change
 */

import { describe, expect, it } from "vitest";
import {
  classifyContentIntent,
  buildCaptionSystemPrompt,
  buildRewriteSystemPrompt,
  type AwoMembrainContext,
  type GenerationIntentHints,
} from "@/server/actions/awo-grounding";

// ─── fixtures ─────────────────────────────────────────────────────────────────

const MULTI_SERVICE_CTX: AwoMembrainContext = {
  brandVoice: ["Premium, warm, and expert."],
  targetAudience: ["Clients seeking professional styling and beauty services."],
  brandDescription: ["A full-service beauty and lifestyle studio."],
  productsAndServices: [
    "Wig installation: provides a natural-looking finish with careful hairline placement.",
    "Bridal makeup: full glam for weddings and formal occasions.",
    "Event photography: professional coverage for milestones and celebrations.",
  ],
  contentPillars: ["Client transformations", "Behind the scenes", "Beauty tips"],
  restrictions: ["Do not use the word 'cheap'."],
};

const NO_HINTS: GenerationIntentHints = {};
const EXPLICIT_PROMPT: GenerationIntentHints = { userPromptIsExplicit: true };
const WITH_CAMPAIGN: GenerationIntentHints = { hasCampaign: true };

// ─── T1: "Welcome to August" classifies as brand_general ─────────────────────

describe("T1 — 'Welcome to August' → brand_general intent", () => {
  it("general month greeting does not trigger service or campaign intent", () => {
    expect(classifyContentIntent("Welcome to August", MULTI_SERVICE_CTX, NO_HINTS)).toBe("brand_general");
  });

  it("'Happy New Month' also classifies as brand_general", () => {
    expect(classifyContentIntent("Happy New Month", MULTI_SERVICE_CTX, NO_HINTS)).toBe("brand_general");
  });
});

// ─── T2: system prompt with operatorPrompt injects subject anchor ─────────────

describe("T2 — system prompt with operatorPrompt injects explicit subject anchor block", () => {
  it("includes an OPERATOR REQUEST section when operatorPrompt is provided", () => {
    const prompt = buildCaptionSystemPrompt(
      "Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general", "Welcome to August",
    );
    expect(prompt).toContain("=== OPERATOR REQUEST ===");
  });

  it("anchor block declares the operator request as the primary semantic anchor", () => {
    const prompt = buildCaptionSystemPrompt(
      "Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general", "Welcome to August",
    );
    expect(prompt.toLowerCase()).toMatch(/primary semantic anchor/);
  });

  it("no OPERATOR REQUEST block is injected when operatorPrompt is absent", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    expect(prompt).not.toContain("=== OPERATOR REQUEST ===");
  });
});

// ─── T3: anchor block contains the operator's prompt text verbatim ────────────

describe("T3 — subject anchor block contains the operator's prompt text verbatim", () => {
  it("anchor block echoes 'Welcome to August' into the system prompt", () => {
    const prompt = buildCaptionSystemPrompt(
      "Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general", "Welcome to August",
    );
    expect(prompt).toContain('"Welcome to August"');
  });

  it("anchor block echoes a different prompt correctly", () => {
    const prompt = buildCaptionSystemPrompt(
      "Studio X", "LinkedIn", MULTI_SERVICE_CTX, "brand_general", "Thank you to our clients",
    );
    expect(prompt).toContain('"Thank you to our clients"');
  });

  it("anchor block states MemBrain defines HOW, not WHAT", () => {
    const prompt = buildCaptionSystemPrompt(
      "Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general", "Welcome to August",
    );
    // Verifies the anchor's key framing instruction is present
    expect(prompt.toLowerCase()).toMatch(/membrain defines how/i);
  });
});

// ─── T4: CTA section is conditional ──────────────────────────────────────────

describe("T4 — CTA section is conditional, not mandatory for all post types", () => {
  it("CTA rule states it is only appropriate when content type warrants it", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX);
    expect(prompt.toLowerCase()).toMatch(/only appropriate when this content type warrants it/);
  });

  it("CTA rule explicitly states greetings do not require a commercial CTA", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX);
    expect(prompt.toLowerCase()).toMatch(/greetings.*commercial cta is not required/);
  });

  it("generic CTA example still present for when a CTA is appropriate", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX);
    expect(prompt.toLowerCase()).toContain("book your appointment");
  });
});

// ─── T5: factual inference prohibition covers occasions ───────────────────────

describe("T5 — factual inference prohibition covers invented occasions and assumed client needs", () => {
  it("'occasions' is listed in the prohibition", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX);
    expect(prompt.toLowerCase()).toContain("occasions");
  });

  it("'assumed client needs' or 'assumed' is listed in the prohibition", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX);
    expect(prompt.toLowerCase()).toMatch(/assumed client needs|assumed/);
  });

  it("original prohibited types are still present", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX);
    const lower = prompt.toLowerCase();
    expect(lower).toContain("techniques");
    expect(lower).toContain("guarantees");
    expect(lower).toContain("outcomes");
  });
});

// ─── T6: "Thank you to our clients" → brand_general ──────────────────────────

describe("T6 — 'Thank you to our clients' → brand_general intent", () => {
  it("appreciation prompt does not trigger service or campaign intent", () => {
    expect(classifyContentIntent("Thank you to our clients", MULTI_SERVICE_CTX, NO_HINTS)).toBe("brand_general");
  });

  it("appreciation prompt with explicit flag still stays brand_general (no service term match)", () => {
    // "Thank you to our clients" contains no service terms from MemBrain
    expect(
      classifyContentIntent("Thank you to our clients", MULTI_SERVICE_CTX, EXPLICIT_PROMPT),
    ).toBe("brand_general");
  });
});

// ─── T7: appreciation prompt preserves subject via anchor block ───────────────

describe("T7 — appreciation prompt system prompt contains subject anchor", () => {
  it("system prompt echoes appreciation subject into OPERATOR REQUEST block", () => {
    const prompt = buildCaptionSystemPrompt(
      "Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general", "Thank you to our clients",
    );
    expect(prompt).toContain('"Thank you to our clients"');
    expect(prompt).toContain("=== OPERATOR REQUEST ===");
  });
});

// ─── T8: "Happy Mother's Day" → brand_general ────────────────────────────────

describe("T8 — 'Happy Mother's Day' → brand_general intent", () => {
  it("occasion greeting does not trigger service or campaign intent", () => {
    expect(classifyContentIntent("Happy Mother's Day", MULTI_SERVICE_CTX, NO_HINTS)).toBe("brand_general");
  });
});

// ─── T9: "Celebrate our anniversary" → brand_general ─────────────────────────

describe("T9 — 'Celebrate our anniversary' → brand_general intent", () => {
  it("brand milestone greeting stays brand_general", () => {
    expect(classifyContentIntent("Celebrate our anniversary", MULTI_SERVICE_CTX, NO_HINTS)).toBe("brand_general");
  });
});

// ─── T10: brand_general intent block declares operator request as primary ─────

describe("T10 — brand_general intent block states operator request is the primary subject", () => {
  it("intent block contains 'operator's explicit request is the primary subject'", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    expect(prompt.toLowerCase()).toMatch(/operator'?s explicit request is the primary subject/);
  });

  it("intent block instructs not to replace the stated theme with a commercial objective", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    expect(prompt.toLowerCase()).toMatch(/commercial objective/);
  });
});

// ─── T11: explicit service request remains service_specific ───────────────────

describe("T11 — explicit service request remains service_specific (regression)", () => {
  it("explicit prompt with known service term → service_specific", () => {
    expect(
      classifyContentIntent("Post about wig installation", MULTI_SERVICE_CTX, EXPLICIT_PROMPT),
    ).toBe("service_specific");
  });

  it("explicit 'bridal makeup' prompt → service_specific", () => {
    expect(
      classifyContentIntent("Promote our bridal makeup service", MULTI_SERVICE_CTX, EXPLICIT_PROMPT),
    ).toBe("service_specific");
  });
});

// ─── T12: educational request remains educational ────────────────────────────

describe("T12 — educational request remains educational (regression)", () => {
  it("'How to' prompt → educational", () => {
    expect(classifyContentIntent("How to care for your wig", MULTI_SERVICE_CTX, NO_HINTS)).toBe("educational");
  });

  it("'Tips for' prompt → educational", () => {
    expect(classifyContentIntent("Tips for choosing the right look", MULTI_SERVICE_CTX, NO_HINTS)).toBe("educational");
  });
});

// ─── T13: campaign with hasCampaign overrides intent ─────────────────────────

describe("T13 — campaign with hasCampaign overrides all other signals (regression)", () => {
  it("hasCampaign=true on a greeting prompt → campaign", () => {
    expect(classifyContentIntent("Welcome to August", MULTI_SERVICE_CTX, WITH_CAMPAIGN)).toBe("campaign");
  });

  it("hasCampaign=true on an educational prompt → campaign", () => {
    expect(
      classifyContentIntent("How to care for your wig", MULTI_SERVICE_CTX, WITH_CAMPAIGN),
    ).toBe("campaign");
  });
});

// ─── T14: brand voice still present in all prompts ───────────────────────────

describe("T14 — brand voice still present in every generated prompt (regression)", () => {
  for (const intent of ["brand_general", "service_specific", "campaign", "educational"] as const) {
    it(`brand voice appears in ${intent} prompt`, () => {
      const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, intent);
      expect(prompt).toContain("Premium, warm, and expert.");
    });
  }
});

// ─── T15: factual grounding rule still present in all prompts ─────────────────

describe("T15 — factual grounding rule still present in every generated prompt (regression)", () => {
  for (const intent of ["brand_general", "service_specific", "campaign", "educational"] as const) {
    it(`factual grounding appears in ${intent} prompt`, () => {
      const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, intent);
      expect(prompt.toLowerCase()).toContain("directly supported by the membrain context");
    });
  }
});

// ─── T16: Products & Services section still present in all prompts ────────────

describe("T16 — Products & Services section still present in every generated prompt (regression)", () => {
  for (const intent of ["brand_general", "service_specific", "campaign", "educational"] as const) {
    it(`[Products & Services] appears in ${intent} prompt`, () => {
      const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, intent);
      expect(prompt).toContain("[Products & Services]");
    });
  }
});

// ─── T17: brand_general treats service reference as optional ──────────────────

describe("T17 — brand_general instruction treats service reference as optional, not required", () => {
  it("brand_general block says 'only when it flows naturally'", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    expect(prompt.toLowerCase()).toMatch(/only when it flows naturally/);
  });

  it("brand_general block does not say services must be included", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    // The block explicitly uses permissive language — "may reference", not "must include"
    expect(prompt.toLowerCase()).toMatch(/may reference multiple offerings/);
  });
});

// ─── T18: buildRewriteSystemPrompt is unaffected ──────────────────────────────

describe("T18 — buildRewriteSystemPrompt is not affected by the subject-anchor change", () => {
  it("rewrite prompt does not contain an OPERATOR REQUEST block", () => {
    const prompt = buildRewriteSystemPrompt("Studio X", "Make it punchy.", MULTI_SERVICE_CTX);
    expect(prompt).not.toContain("=== OPERATOR REQUEST ===");
  });

  it("rewrite prompt still includes factual grounding rule", () => {
    const prompt = buildRewriteSystemPrompt("Studio X", "Make it punchy.", MULTI_SERVICE_CTX);
    expect(prompt.toLowerCase()).toContain("directly supported by the membrain context");
  });

  it("rewrite prompt still includes brand voice", () => {
    const prompt = buildRewriteSystemPrompt("Studio X", "Make it punchy.", MULTI_SERVICE_CTX);
    expect(prompt).toContain("Premium, warm, and expert.");
  });
});
