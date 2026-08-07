/**
 * AWO AI Assist context-awareness tests.
 *
 * Verifies that the AWO panel correctly restricts available actions based on
 * whether the draft body is empty or has content — and that the correct
 * server action (generateCaption vs rewriteContent) is selected.
 *
 * Test mapping (per spec):
 *  1. Empty string      → Generate first draft enabled
 *  2. Whitespace-only   → Generate first draft enabled
 *  3. Empty draft       → Rewrite disabled
 *  4. Existing draft    → Generate first draft disabled
 *  5. Existing draft    → Rewrite enabled
 *  6. Generate first draft → calls generateCaption(), NOT rewriteContent()
 *  7. Prompt/context   → reaches generateCaption()
 *  8. Organisation ID  → reaches generateCaption()
 *  9. Existing grounding/compliance path remains used
 * 10. Suggestion returned for review (see tests/awo-assist-ui.test.tsx)
 */

import { describe, expect, it } from "vitest";
import {
  isDraftBodyEmpty,
  resolveEffectiveAiAction,
  isAiActionAvailable,
  rewriteInstructionForAction,
  buildGenerateCaptionArgs,
} from "@/components/content/awo-assist-logic";

// ---------------------------------------------------------------------------
// Tests 1 & 2 — empty / whitespace body → Generate first draft enabled
// ---------------------------------------------------------------------------
describe("isDraftBodyEmpty", () => {
  it("returns true for an empty string (test 1)", () => {
    expect(isDraftBodyEmpty("")).toBe(true);
  });

  it("returns true for whitespace-only content (test 2)", () => {
    expect(isDraftBodyEmpty("   ")).toBe(true);
    expect(isDraftBodyEmpty("\n\t")).toBe(true);
  });

  it("returns false when the body has non-whitespace content", () => {
    expect(isDraftBodyEmpty("Hello")).toBe(false);
    expect(isDraftBodyEmpty("  Hello  ")).toBe(false);
  });
});

describe("resolveEffectiveAiAction — empty body selects generate (tests 1 & 2)", () => {
  it("resolves to 'generate' for an empty body regardless of selected action (test 1)", () => {
    expect(resolveEffectiveAiAction("", "rewrite")).toBe("generate");
    expect(resolveEffectiveAiAction("", "shorten")).toBe("generate");
    expect(resolveEffectiveAiAction("", "expand")).toBe("generate");
  });

  it("resolves to 'generate' for whitespace-only body (test 2)", () => {
    expect(resolveEffectiveAiAction("   ", "rewrite")).toBe("generate");
  });

  it("falls back to 'rewrite' when non-empty body but 'generate' is selected (test 4)", () => {
    expect(resolveEffectiveAiAction("Some draft content.", "generate")).toBe("rewrite");
  });

  it("preserves the selected content-dependent action when body has content (test 5)", () => {
    expect(resolveEffectiveAiAction("Draft exists.", "shorten")).toBe("shorten");
    expect(resolveEffectiveAiAction("Draft exists.", "expand")).toBe("expand");
    expect(resolveEffectiveAiAction("Draft exists.", "change_tone")).toBe("change_tone");
    expect(resolveEffectiveAiAction("Draft exists.", "clarity")).toBe("clarity");
  });
});

// ---------------------------------------------------------------------------
// Tests 3, 4 & 5 — isAiActionAvailable enforces the context rules
// ---------------------------------------------------------------------------
describe("isAiActionAvailable", () => {
  it("reports rewrite as unavailable for an empty draft (test 3)", () => {
    expect(isAiActionAvailable("", "rewrite")).toBe(false);
  });

  it("reports shorten, expand, change_tone, alternative_captions, clarity as unavailable when empty (test 3)", () => {
    for (const action of ["shorten", "expand", "change_tone", "alternative_captions", "clarity"]) {
      expect(isAiActionAvailable("", action)).toBe(false);
    }
  });

  it("reports generate as unavailable when the draft has content (test 4)", () => {
    expect(isAiActionAvailable("Luxury Wig Installation.", "generate")).toBe(false);
  });

  it("reports rewrite as available when the draft has content (test 5)", () => {
    expect(isAiActionAvailable("Luxury Wig Installation.", "rewrite")).toBe(true);
  });

  it("reports all content-dependent actions as available when draft has content (test 5)", () => {
    const body = "Some draft content here.";
    for (const action of ["rewrite", "shorten", "expand", "change_tone", "alternative_captions", "clarity"]) {
      expect(isAiActionAvailable(body, action)).toBe(true);
    }
  });

  it("reports generate as available for an empty body", () => {
    expect(isAiActionAvailable("", "generate")).toBe(true);
    expect(isAiActionAvailable("   ", "generate")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Generate first draft routes to generateCaption, not rewriteContent
// ---------------------------------------------------------------------------
describe("resolveEffectiveAiAction — action routing (test 6)", () => {
  it("resolves to 'generate' (→ generateCaption) for an empty body, never to 'rewrite' (→ rewriteContent)", () => {
    const resolved = resolveEffectiveAiAction("", "rewrite");
    expect(resolved).toBe("generate");
    expect(resolved).not.toBe("rewrite");
  });

  it("the 'generate' effective action is the trigger for generateCaption() in handleAiAssist", () => {
    // The component branches on effectiveAiAction === "generate" → calls generateCaption().
    // Any other value → calls rewriteContent(). This verifies the resolved action is "generate"
    // so the generateCaption path is taken, not rewriteContent.
    const resolvedForEmpty = resolveEffectiveAiAction("", "generate");
    const resolvedForContent = resolveEffectiveAiAction("Existing draft.", "rewrite");
    expect(resolvedForEmpty).toBe("generate");
    expect(resolvedForContent).not.toBe("generate");
  });
});

// ---------------------------------------------------------------------------
// Tests 7 & 8 — Prompt/context and organisation ID reach generateCaption()
// ---------------------------------------------------------------------------
describe("buildGenerateCaptionArgs (tests 7 & 8)", () => {
  it("places the user prompt in the second argument (test 7)", () => {
    const args = buildGenerateCaptionArgs("org-1", "Create an Instagram post about Luxury Wig Installation", "Draft title", null);
    expect(args[1]).toBe("Create an Instagram post about Luxury Wig Installation");
  });

  it("falls back to draft title when prompt is empty (test 7)", () => {
    const args = buildGenerateCaptionArgs("org-1", "", "Luxury Wig Caption", null);
    expect(args[1]).toBe("Luxury Wig Caption");
  });

  it("uses the generic fallback when both prompt and title are absent (test 7)", () => {
    const args = buildGenerateCaptionArgs("org-1", "", null, null);
    expect(args[1]).toBe("Generate a creative draft");
  });

  it("places the organisation ID in the first argument (test 8)", () => {
    const args = buildGenerateCaptionArgs("org-mervic-123", "prompt", null, null);
    expect(args[0]).toBe("org-mervic-123");
  });

  // Test 5 (new spec) — generateCaption third argument must be a social platform, not a category label
  it("passes a social platform (scheduledPlatform) as the third argument, not a MemBrain category label (test 5)", () => {
    const args = buildGenerateCaptionArgs("org-1", "", null, "Instagram");
    expect(args[2]).toBe("Instagram");
  });

  it("defaults to 'social media' — not 'General' — when no platform is scheduled (test 5)", () => {
    // "social media" is semantically correct in "You write high-quality social media
    // content for social media." — a content-pillar category label such as
    // "Brand Voice & Positioning" or "Products & Services" would be nonsensical here.
    const args = buildGenerateCaptionArgs("org-1", "my prompt", null, null);
    expect(args[2]).toBe("social media");
    expect(args[2]).not.toBe("General");
    // Confirm a MemBrain category label is NOT a valid platform value
    const categoryLabelArgs = buildGenerateCaptionArgs("org-1", "", null, "Brand Voice & Positioning");
    // When a caller accidentally passes a category label, it flows through unchanged.
    // This test documents that the correct caller-side value is scheduledPlatform, not category.label.
    expect(categoryLabelArgs[2]).toBe("Brand Voice & Positioning");
  });

  it("passes a TikTok platform through correctly", () => {
    const args = buildGenerateCaptionArgs("org-1", "", null, "TikTok");
    expect(args[2]).toBe("TikTok");
  });
});

// ---------------------------------------------------------------------------
// Test 9 — Existing grounding/compliance path remains used
// ---------------------------------------------------------------------------
describe("grounding/compliance path integrity (test 9)", () => {
  it("resolves to 'generate' for empty drafts — the action that calls generateCaption(), which carries MemBrain extraction and compliance checks", () => {
    // The component's handleAiAssist branches: effectiveAiAction === "generate" → generateCaption().
    // generateCaption() in src/server/actions/awo.ts runs extractAwoMembrainContext(),
    // buildCaptionSystemPrompt() (grounding rules), and applyComplianceCheck() (compliance).
    // All of this is verified in tests/awo-grounding.test.ts. Here we confirm that the
    // action resolved for an empty draft is "generate" — the one that uses that path.
    expect(resolveEffectiveAiAction("", "rewrite")).toBe("generate");
    expect(resolveEffectiveAiAction("  \n  ", "rewrite")).toBe("generate");
  });

  it("rewriteInstructionForAction returns valid AiRewriteInstruction for all content-dependent actions", () => {
    const validInstructions = new Set(["expand", "shorten", "professional", "casual", "punchy"]);
    for (const action of ["rewrite", "shorten", "expand", "change_tone", "alternative_captions", "clarity"]) {
      expect(validInstructions.has(rewriteInstructionForAction(action))).toBe(true);
    }
  });
});
