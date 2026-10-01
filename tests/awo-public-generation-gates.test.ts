vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("@/infrastructure/ai/provider-factory", () => ({
  getAIProvider: vi.fn(),
}));

vi.mock("@/core/application/use-cases/membrain", () => ({
  getMembrainOverview: vi.fn(),
}));

vi.mock("@/core/application/use-cases/engagement", () => ({
  generateEngagementRecommendation: vi.fn(),
  getEngagementLearningOverview: vi.fn(),
  applyEngagementRecommendation: vi.fn(),
  recordEngagementCommercialOutcome: vi.fn(),
  recordEngagementFeedback: vi.fn(),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateCaption,
  generateEngagementRecommendationAction,
  generateHashtags,
  rewriteContent,
} from "@/server/actions/awo";
import { requireContext } from "@/server/container";
import { getAIProvider } from "@/infrastructure/ai/provider-factory";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { generateEngagementRecommendation } from "@/core/application/use-cases/engagement";
import { ValidationError } from "@/core/domain/errors";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const MISSING_CONTEXT = [
  "An active Brand Description entry is required in MemBrain.",
  "Source content is required before Awo can generate.",
];

const ai = {
  generateText: vi.fn(),
  generateObject: vi.fn(),
  analyzeImage: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAIProvider).mockReturnValue(ai as never);
  vi.mocked(requireContext).mockResolvedValue({
    actor: { id: "actor-1", isPlatformAdmin: false },
    organisations: {
      findById: vi.fn(async () => ({ id: ORG_ID, name: "Example" })),
      viewerRole: vi.fn(async () => "lead"),
    },
    membrain: {},
  } as never);
  vi.mocked(getMembrainOverview).mockResolvedValue({
    totalEntries: 0,
    categories: [],
    groups: [],
    uncategorised: [],
    readiness: {},
  } as never);
});

describe("public Awo generation minimum-context gates", () => {
  it.each([
    ["caption", () => generateCaption(ORG_ID, "", "instagram")],
    ["rewrite", () => rewriteContent(ORG_ID, "", "shorten")],
    ["hashtags", () => generateHashtags(ORG_ID, "")],
  ])("returns structured needs_attention from %s without invoking AI", async (_surface, invoke) => {
    await expect(invoke()).resolves.toEqual({
      status: "needs_attention",
      missingContext: MISSING_CONTEXT,
    });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.generateObject).not.toHaveBeenCalled();
    expect(ai.analyzeImage).not.toHaveBeenCalled();
  });

  it("returns structured needs_attention from engagement without invoking AI", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(generateEngagementRecommendation).mockRejectedValueOnce(new ValidationError(
      `Awo needs attention before generation: ${MISSING_CONTEXT.join(" ")}`,
      { missingContext: MISSING_CONTEXT },
    ));

    await expect(generateEngagementRecommendationAction({
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "instagram",
    })).resolves.toMatchObject({
      ok: false,
      status: "needs_attention",
      missingContext: MISSING_CONTEXT,
    });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.generateObject).not.toHaveBeenCalled();
    expect(ai.analyzeImage).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
