import { describe, expect, it } from "vitest";
import { assessGenerationMinimumContext } from "@/core/application/use-cases/generation";
import { buildCaptionSystemPrompt, buildRewriteSystemPrompt, type AwoMembrainContext } from "@/server/actions/awo-grounding";

const completeContext: AwoMembrainContext = {
  brandDescription: ["A verified organisation description."],
  brandVoice: [],
  targetAudience: [],
  productsAndServices: [],
  contentPillars: [],
  restrictions: [],
};

describe("shared minimum generation context", () => {
  it("returns needs_attention with the same missing-context list used by generation readiness", () => {
    expect(assessGenerationMinimumContext({ hasBrandDescription: false, sourceText: "" })).toEqual({
      status: "needs_attention",
      missingContext: [
        "An active Brand Description entry is required in MemBrain.",
        "Source content is required before Awo can generate.",
      ],
    });
  });

  it("allows caption, hashtag, rewrite and engagement callers to share one ready result", () => {
    expect(assessGenerationMinimumContext({ hasBrandDescription: true, sourceText: "Grounded source" })).toEqual({
      status: "ready_for_awo",
      missingContext: [],
    });
  });

  it("never writes missing-context placeholders or a professional-marketer fallback into prompts", () => {
    const caption = buildCaptionSystemPrompt("Example", "Instagram", completeContext);
    const rewrite = buildRewriteSystemPrompt("Example", "Make it concise.", completeContext);
    expect(`${caption}\n${rewrite}`).not.toMatch(/\(none recorded\)|professional marketer/i);
  });
});
