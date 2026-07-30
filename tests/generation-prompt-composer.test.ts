import { describe, expect, it } from "vitest";
import { composePromptSpecification } from "@/core/application/use-cases/generation/prompt-composer";
import type { GenerationContext } from "@/core/domain/entities/generation";

function context(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    organisation: { id: "org-1", name: "Northside Dental", industry: "Healthcare", websiteUrl: null },
    campaign: {
      id: "campaign-1",
      name: "Spring promotion",
      objective: "Fill appointment slots",
      targetAudience: "Existing patients",
      primaryCTA: "Book your check-up",
      platforms: ["instagram"],
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      status: "active",
    },
    brand: {
      brandDescription: ["A friendly neighbourhood dental practice."],
      brandVoice: ["Warm, direct, never corporate."],
      targetAudience: ["Local families."],
      contentPillars: ["Preventive care", "Patient stories", "Community involvement"],
      productsAndServices: ["General check-ups", "Cosmetic dentistry"],
      restrictions: ["Never mention competitor pricing."],
    },
    draft: {
      id: "draft-1",
      contentType: "social_post",
      status: "draft",
      title: "Spring check-up reminder",
      body: "Book your check-up today.",
      summary: null,
      category: { id: "cat-1", key: "content_pillars", label: "Content pillars" },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    requestedBy: { id: "user-1", fullName: "Strategist", email: "strategist@villiz.com" },
    assembledAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("composePromptSpecification", () => {
  it("is a structured object, not a text string", () => {
    const spec = composePromptSpecification(context());
    expect(typeof spec).toBe("object");
    expect(spec).not.toHaveProperty("prompt");
    expect(spec).not.toHaveProperty("text");
  });

  it("carries the campaign objective into the generation goal when a campaign is linked", () => {
    const spec = composePromptSpecification(context());
    expect(spec.generationGoal).toContain("Fill appointment slots");
  });

  it("falls back to a content-type-based goal when no campaign is linked", () => {
    const spec = composePromptSpecification(context({ campaign: null }));
    expect(spec.generationGoal).toContain("social post");
    expect(spec.generationGoal).toContain("Spring check-up reminder");
  });

  it("carries MemBrain restrictions through as constraints, unmodified", () => {
    const spec = composePromptSpecification(context());
    expect(spec.constraints).toEqual(["Never mention competitor pricing."]);
  });

  it("always includes at least one standing principle", () => {
    const spec = composePromptSpecification(context());
    expect(spec.systemContext.principles.length).toBeGreaterThan(0);
  });

  it("passes the campaign context through unchanged when present, and null when absent", () => {
    expect(composePromptSpecification(context()).campaignContext?.name).toBe("Spring promotion");
    expect(composePromptSpecification(context({ campaign: null })).campaignContext).toBeNull();
  });
});
