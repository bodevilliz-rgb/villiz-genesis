/**
 * Regression tests — Multi-service content intent / service overweighting.
 *
 * Root cause:
 *   buildCaptionSystemPrompt had no intent instruction.  For a general brand
 *   post ("Welcome to August"), the model received all MemBrain services in
 *   retrieval order (most-recently-updated first) with no rule about how to
 *   weight them.  LLM primacy bias caused the first service in the list to
 *   dominate — producing a luxury wig installation advertisement from a
 *   month-greeting prompt.
 *
 * Fix:
 *   1. classifyContentIntent() classifies every request into one of four
 *      intents (brand_general / service_specific / campaign / educational)
 *      using structural signals (campaign linked) first, then semantic
 *      analysis against actual MemBrain offering terms (generic, no hardcoding).
 *   2. buildCaptionSystemPrompt() now accepts an intent parameter and injects
 *      an intent-specific instruction block that explicitly prohibits
 *      single-service dominance for brand_general posts.
 *   3. generateCaption() classifies intent server-side (with full MemBrain
 *      context) and passes the result to the prompt builder.
 *   4. buildGenerateCaptionArgs() carries structural hints from the call-site.
 *
 * T1  — multi-service brand + "Welcome to August" → brand_general intent
 * T2  — brand_general prompt includes no-single-service-dominance instruction
 * T3  — brand_general prompt instructs model not to infer primary service from retrieval order
 * T4  — explicit service request → service_specific intent
 * T5  — service_specific prompt includes service-focus instruction
 * T6  — campaign-linked draft → campaign intent regardless of prompt text
 * T7  — campaign prompt includes campaign-primary instruction
 * T8  — educational prompt → educational intent, topic-led instruction
 * T9  — service-term matching is generic (works without any client-specific hardcoding)
 * T10 — different multi-service client: no hardcoded terms, intent still classifies correctly
 * T11 — single-service business: general post still works naturally (brand_general)
 * T12 — brand voice section still appears in brand_general prompt
 * T13 — MemBrain Products & Services section still appears in every prompt
 * T14 — rewrite path (buildRewriteSystemPrompt) is unchanged by this fix
 * T15 — buildGenerateCaptionArgs passes intent hints as 4th tuple element
 */

import { describe, expect, it } from "vitest";
import {
  classifyContentIntent,
  buildCaptionSystemPrompt,
  type AwoMembrainContext,
  type GenerationIntentHints,
} from "@/server/actions/awo-grounding";
import { buildRewriteSystemPrompt } from "@/server/actions/awo-grounding";
import {
  buildGenerateCaptionArgs,
} from "@/components/content/awo-assist-logic";

// ─── fixtures ─────────────────────────────────────────────────────────────────

/** Multi-service context — three distinct, generic-named services. */
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

/** Single-service context — one offering only. */
const SINGLE_SERVICE_CTX: AwoMembrainContext = {
  brandVoice: ["Authoritative and approachable."],
  targetAudience: ["Small business owners."],
  brandDescription: ["A boutique accounting practice."],
  productsAndServices: ["Tax return preparation: end-to-end self-assessment filing."],
  contentPillars: [],
  restrictions: [],
};

/** No-offering context — MemBrain has no product entries yet (used indirectly). */
const _NO_OFFERING_CTX: AwoMembrainContext = {
  brandVoice: ["Friendly and clear."],
  targetAudience: ["General public."],
  brandDescription: ["A community services organisation."],
  productsAndServices: [],
  contentPillars: [],
  restrictions: [],
}; void _NO_OFFERING_CTX;

const WITH_CAMPAIGN: GenerationIntentHints = { hasCampaign: true };
const EXPLICIT_PROMPT: GenerationIntentHints = { userPromptIsExplicit: true };
const NO_HINTS: GenerationIntentHints = {};

// ─── T1: "Welcome to August" classifies as brand_general ─────────────────────

describe("T1 — multi-service brand + 'Welcome to August' → brand_general intent", () => {
  it("classifies a generic month-greeting as brand_general (not a single service)", () => {
    const intent = classifyContentIntent("Welcome to August", MULTI_SERVICE_CTX, NO_HINTS);
    expect(intent).toBe("brand_general");
  });

  it("'Happy New Month' also classifies as brand_general", () => {
    expect(classifyContentIntent("Happy New Month", MULTI_SERVICE_CTX, NO_HINTS)).toBe("brand_general");
  });

  it("'About us' classifies as brand_general", () => {
    expect(classifyContentIntent("About us", MULTI_SERVICE_CTX, NO_HINTS)).toBe("brand_general");
  });
});

// ─── T2: brand_general prompt prohibits single-service dominance ──────────────

describe("T2 — brand_general prompt includes no-single-service-dominance instruction", () => {
  it("system prompt explicitly says not to make one service the central subject", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    expect(prompt.toLowerCase()).toMatch(/do not select one product or service as the central subject/);
  });

  it("brand_general instruction does not name any specific service", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    const intentSection = prompt.split("=== CONTENT INTENT")[1] ?? "";
    // The instruction block must not hardcode any of the service names
    expect(intentSection.toLowerCase()).not.toContain("wig");
    expect(intentSection.toLowerCase()).not.toContain("makeup");
    expect(intentSection.toLowerCase()).not.toContain("photography");
  });

  it("default intent (no 4th arg) produces brand_general instruction", () => {
    const withDefault = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX);
    const withExplicit = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    expect(withDefault).toBe(withExplicit);
  });
});

// ─── T3: retrieval order must not determine primary service ───────────────────

describe("T3 — brand_general prompt says retrieval order does not imply importance", () => {
  it("includes explicit retrieval-order disclaimer", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "brand_general");
    expect(prompt.toLowerCase()).toMatch(/retrieval order does not imply importance/);
  });
});

// ─── T4: explicit service request → service_specific ─────────────────────────

describe("T4 — explicit service request → service_specific intent", () => {
  it("prompt containing a known offering term → service_specific when userPromptIsExplicit", () => {
    const intent = classifyContentIntent(
      "Create a post about wig installation",
      MULTI_SERVICE_CTX,
      EXPLICIT_PROMPT,
    );
    expect(intent).toBe("service_specific");
  });

  it("prompt containing 'makeup' → service_specific for the multi-service client", () => {
    const intent = classifyContentIntent(
      "Promote our bridal makeup service",
      MULTI_SERVICE_CTX,
      EXPLICIT_PROMPT,
    );
    expect(intent).toBe("service_specific");
  });

  it("service term in prompt WITHOUT userPromptIsExplicit → NOT service_specific (no false positive on title)", () => {
    // Draft title auto-passed as prompt without a user-typed override should not trigger service_specific
    const intent = classifyContentIntent(
      "wig installation showcase",
      MULTI_SERVICE_CTX,
      { userPromptIsExplicit: false },
    );
    expect(intent).toBe("brand_general");
  });
});

// ─── T5: service_specific prompt includes service-focus instruction ───────────

describe("T5 — service_specific prompt includes service-focus instruction", () => {
  it("system prompt tells model to focus on the relevant service", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "service_specific");
    expect(prompt.toLowerCase()).toMatch(/focus on the most relevant product or service/);
  });
});

// ─── T6: campaign-linked draft → campaign intent ──────────────────────────────

describe("T6 — campaign-linked draft → campaign intent regardless of prompt text", () => {
  it("hasCampaign=true overrides all other signals", () => {
    expect(classifyContentIntent("Welcome to August", MULTI_SERVICE_CTX, WITH_CAMPAIGN)).toBe("campaign");
    expect(classifyContentIntent("How to care for your wig", MULTI_SERVICE_CTX, WITH_CAMPAIGN)).toBe("campaign");
    expect(classifyContentIntent("wig installation post", MULTI_SERVICE_CTX, { ...WITH_CAMPAIGN, userPromptIsExplicit: true })).toBe("campaign");
  });
});

// ─── T7: campaign prompt includes campaign-primary instruction ────────────────

describe("T7 — campaign prompt includes campaign-as-primary-frame instruction", () => {
  it("system prompt tells model the campaign context is the primary frame", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "campaign");
    expect(prompt.toLowerCase()).toMatch(/campaign context or occasion is the primary frame/);
  });
});

// ─── T8: educational intent → topic-led instruction ──────────────────────────

describe("T8 — educational prompt → educational intent, topic-led instruction", () => {
  it("'How to care for your wig' → educational", () => {
    expect(classifyContentIntent("How to care for your wig", MULTI_SERVICE_CTX, NO_HINTS)).toBe("educational");
  });

  it("'Tips for choosing the right look' → educational", () => {
    expect(classifyContentIntent("Tips for choosing the right look", MULTI_SERVICE_CTX, NO_HINTS)).toBe("educational");
  });

  it("educational system prompt is topic-led, not sales-led", () => {
    const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, "educational");
    expect(prompt.toLowerCase()).toMatch(/topic-led, not sales-led/);
  });
});

// ─── T9: service matching is generic (no client-specific hardcoding) ──────────

describe("T9 — service-term matching is generic across any client's MemBrain offerings", () => {
  it("matches a tax-filing term from an accounting client's MemBrain entry", () => {
    const intent = classifyContentIntent(
      "Book your tax return preparation today",
      SINGLE_SERVICE_CTX,
      EXPLICIT_PROMPT,
    );
    expect(intent).toBe("service_specific");
  });

  it("does not match a general greeting against a single-service client", () => {
    const intent = classifyContentIntent("Happy New Year", SINGLE_SERVICE_CTX, NO_HINTS);
    expect(intent).toBe("brand_general");
  });
});

// ─── T10: different multi-service client — no hardcoded terms ─────────────────

describe("T10 — different multi-service client: intent classifies without client-specific code", () => {
  const techAgencyCtx: AwoMembrainContext = {
    brandVoice: ["Bold and results-driven."],
    targetAudience: ["Tech startups."],
    brandDescription: ["A digital agency."],
    productsAndServices: [
      "Brand strategy: positioning and messaging for early-stage startups.",
      "Website design: custom Webflow and React builds.",
      "Growth marketing: SEO, paid acquisition, and conversion optimisation.",
    ],
    contentPillars: [],
    restrictions: [],
  };

  it("general company update → brand_general (not dominated by first service)", () => {
    expect(classifyContentIntent("Exciting news from us this quarter", techAgencyCtx, NO_HINTS)).toBe("brand_general");
  });

  it("explicit website service request → service_specific", () => {
    expect(
      classifyContentIntent("Our website design process explained", techAgencyCtx, EXPLICIT_PROMPT),
    ).toBe("service_specific");
  });

  it("educational post about growth → educational (not service_specific even though 'growth' is in offering)", () => {
    // 'growth' is only 6 chars and appears in the offering, but "how to grow" hits educational pattern first
    expect(
      classifyContentIntent("How to grow your startup audience", techAgencyCtx, EXPLICIT_PROMPT),
    ).toBe("educational");
  });
});

// ─── T11: single-service business still works naturally ───────────────────────

describe("T11 — single-service business: general post works naturally as brand_general", () => {
  it("month greeting for single-service client → brand_general", () => {
    expect(classifyContentIntent("Welcome to March", SINGLE_SERVICE_CTX, NO_HINTS)).toBe("brand_general");
  });

  it("brand_general prompt for single-service client still includes that service in MemBrain section", () => {
    const prompt = buildCaptionSystemPrompt("Boutique Accounting", "LinkedIn", SINGLE_SERVICE_CTX, "brand_general");
    expect(prompt).toContain("Tax return preparation");
  });
});

// ─── T12: brand voice still present in every prompt ──────────────────────────

describe("T12 — brand voice remains in every generated prompt", () => {
  for (const intent of ["brand_general", "service_specific", "campaign", "educational"] as const) {
    it(`brand voice appears in ${intent} prompt`, () => {
      const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, intent);
      expect(prompt).toContain("Premium, warm, and expert.");
    });
  }
});

// ─── T13: MemBrain Products & Services section appears in every prompt ─────────

describe("T13 — MemBrain Products & Services section present in every intent variant", () => {
  for (const intent of ["brand_general", "service_specific", "campaign", "educational"] as const) {
    it(`[Products & Services] header appears in ${intent} prompt`, () => {
      const prompt = buildCaptionSystemPrompt("Studio X", "Instagram", MULTI_SERVICE_CTX, intent);
      expect(prompt).toContain("[Products & Services]");
      expect(prompt).toContain("Wig installation:");
    });
  }
});

// ─── T14: rewrite path is unaffected ─────────────────────────────────────────

describe("T14 — buildRewriteSystemPrompt is unchanged (rewrite path does not regress)", () => {
  it("still includes factual grounding rule", () => {
    const prompt = buildRewriteSystemPrompt("Studio X", "Make it punchy.", MULTI_SERVICE_CTX);
    expect(prompt.toLowerCase()).toContain("directly supported by the membrain context");
  });

  it("still includes brand voice", () => {
    const prompt = buildRewriteSystemPrompt("Studio X", "Make it punchy.", MULTI_SERVICE_CTX);
    expect(prompt).toContain("Premium, warm, and expert.");
  });

  it("does NOT include a content intent block (rewrite has no intent classification)", () => {
    const prompt = buildRewriteSystemPrompt("Studio X", "Make it punchy.", MULTI_SERVICE_CTX);
    expect(prompt).not.toContain("=== CONTENT INTENT");
  });
});

// ─── T15: buildGenerateCaptionArgs passes intent hints as 4th element ─────────

describe("T15 — buildGenerateCaptionArgs carries intent hints through to generateCaption", () => {
  it("returns a 4-element tuple with intent hints as the 4th element", () => {
    const hints = { hasCampaign: true, userPromptIsExplicit: true };
    const args = buildGenerateCaptionArgs("org-1", "Welcome to August", null, "Instagram", hints);
    expect(args[0]).toBe("org-1");
    expect(args[1]).toBe("Welcome to August");
    expect(args[2]).toBe("Instagram");
    expect(args[3]).toEqual(hints);
  });

  it("4th element is undefined when no hints supplied", () => {
    const args = buildGenerateCaptionArgs("org-1", "Welcome to August", null, null);
    expect(args[3]).toBeUndefined();
  });

  it("existing 3-element destructure still works (no break to callers)", () => {
    const [orgId, prompt, platform] = buildGenerateCaptionArgs("org-1", "test", null, "TikTok");
    expect(orgId).toBe("org-1");
    expect(prompt).toBe("test");
    expect(platform).toBe("TikTok");
  });
});
