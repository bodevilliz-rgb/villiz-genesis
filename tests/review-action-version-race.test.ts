vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordReviewDecisionAction } from "@/server/actions/review";
import { requireContext } from "@/server/container";
import { ValidationError } from "@/core/domain/errors";
import { assessRecommendationDistributionEligibility } from "@/core/application/use-cases/engagement";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000004";

type TestRecommendation = {
  id: string;
  draftVersion: number;
  creativeGuidance: {
    visibilityPlan?: {
      distributionGate: "pass" | "blocked";
      distributionReadinessScore: number;
      distributionBlockers: string[];
    };
  };
};

function recommendation(draftVersion: number): TestRecommendation {
  return {
    id: `recommendation-${draftVersion}`,
    draftVersion,
    creativeGuidance: {
      visibilityPlan: {
        distributionGate: "pass",
        distributionReadinessScore: 100,
        distributionBlockers: [],
      },
    },
  };
}

function approvalForm(): FormData {
  const form = new FormData();
  form.set("organisationId", ORG_ID);
  form.set("draftId", DRAFT_ID);
  form.set("decision", "approve");
  form.set("comment", "Ready to publish");
  return form;
}

function draft(version: number) {
  return {
    id: DRAFT_ID,
    organisationId: ORG_ID,
    title: "Versioned draft",
    body: "Caption",
    status: "needs_review" as const,
    version,
    createdBy: { id: AUTHOR_ID, fullName: "Author", email: "author@villiz.test" },
    assignedReviewer: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordReviewDecisionAction draft-version concurrency", () => {
  it("propagates the assessed version so an intervening edit cannot approve the newer draft", async () => {
    const assessedDraft = draft(7);
    const editedDraft = draft(8);
    const findDraft = vi.fn()
      .mockResolvedValueOnce(assessedDraft)
      .mockResolvedValueOnce(editedDraft);
    const recordDecision = vi.fn(async (decision: { expectedDraftVersion: number | null }) => {
      if (decision.expectedDraftVersion !== editedDraft.version) {
        throw new ValidationError("Draft changed while approval was being recorded.");
      }
      return { ...editedDraft, status: "approved" as const };
    });
    const context = {
      actor: { id: ACTOR_ID, isPlatformAdmin: false },
      content: { findDraft },
      engagement: {
        findLatest: vi.fn(async () => recommendation(7)),
        findLatestForDraftVersion: vi.fn(async () => recommendation(7)),
        findLatestFeedback: vi.fn(async () => null),
      },
      organisations: { viewerRole: vi.fn(async () => "lead"), listMembers: vi.fn(async () => []) },
      reviews: { recordDecision, listHistory: vi.fn(async () => []) },
      audits: { recordEvent: vi.fn(async () => undefined) },
      notifications: { createNotification: vi.fn(async () => undefined) },
    };
    vi.mocked(requireContext).mockResolvedValue(context as never);

    const result = await recordReviewDecisionAction(
      { status: "idle", message: "" },
      approvalForm(),
    );

    expect(findDraft).toHaveBeenCalledTimes(2);
    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approved", expectedDraftVersion: 7 }),
    );
    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/changed while approval/i) });
  });
});

describe("recordReviewDecisionAction intelligence governance", () => {
  function context(options: {
    latestRecommendation?: TestRecommendation | null;
    currentRecommendation?: TestRecommendation | null;
  } = {}) {
    const currentDraft = draft(7);
    const latestRecommendation = options.latestRecommendation ?? null;
    const currentRecommendation = options.currentRecommendation ?? null;
    return {
      actor: { id: ACTOR_ID, isPlatformAdmin: false },
      content: { findDraft: vi.fn(async () => currentDraft) },
      engagement: {
        findLatest: vi.fn(async () => latestRecommendation),
        findLatestForDraftVersion: vi.fn(async () => currentRecommendation),
        findLatestFeedback: vi.fn(async () => null),
      },
      organisations: { viewerRole: vi.fn(async () => "lead"), listMembers: vi.fn(async () => []) },
      reviews: {
        recordDecision: vi.fn(async () => ({ ...currentDraft, status: "approved" as const })),
        listHistory: vi.fn(async () => []),
      },
      audits: { recordEvent: vi.fn(async () => undefined) },
      notifications: { createNotification: vi.fn(async () => undefined) },
    };
  }

  it("allows normal approval when the current recommendation passes the distribution gate", async () => {
    const currentRecommendation = recommendation(7);
    const deps = context({ latestRecommendation: currentRecommendation, currentRecommendation });
    vi.mocked(requireContext).mockResolvedValue(deps as never);

    const result = await recordReviewDecisionAction({ status: "idle", message: "" }, approvalForm());

    expect(result).toMatchObject({ status: "success", message: "Approved." });
    expect(assessRecommendationDistributionEligibility(currentRecommendation as never, 7, null).eligible).toBe(true);
    expect(deps.reviews.recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      action: "approved",
      expectedDraftVersion: 7,
    }));
  });

  it("blocks normal approval when no current Awo recommendation exists", async () => {
    const deps = context();
    vi.mocked(requireContext).mockResolvedValue(deps as never);

    const result = await recordReviewDecisionAction({ status: "idle", message: "" }, approvalForm());

    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/approval blocked/i) });
    expect(deps.reviews.recordDecision).not.toHaveBeenCalled();
  });

  it("cannot bypass the Awo gate with a crafted manual approval field", async () => {
    const deps = context();
    vi.mocked(requireContext).mockResolvedValue(deps as never);
    const form = approvalForm();
    form.set("approvalBasis", "manual_no_awo");

    const result = await recordReviewDecisionAction({ status: "idle", message: "" }, form);

    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/approval blocked/i) });
    expect(deps.reviews.recordDecision).not.toHaveBeenCalled();
  });

  it("blocks normal approval when only a stale recommendation exists", async () => {
    const staleRecommendation = recommendation(6);
    const deps = context({ latestRecommendation: staleRecommendation });
    vi.mocked(requireContext).mockResolvedValue(deps as never);

    const result = await recordReviewDecisionAction({ status: "idle", message: "" }, approvalForm());

    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/approval blocked/i) });
    expect(assessRecommendationDistributionEligibility(staleRecommendation as never, 7, null).eligible).toBe(false);
    expect(deps.reviews.recordDecision).not.toHaveBeenCalled();
  });

  it("blocks normal approval for a pre-gate recommendation", async () => {
    const preGateRecommendation = {
      ...recommendation(7),
      creativeGuidance: {},
    };
    const deps = context({
      latestRecommendation: preGateRecommendation,
      currentRecommendation: preGateRecommendation,
    });
    vi.mocked(requireContext).mockResolvedValue(deps as never);

    const result = await recordReviewDecisionAction({ status: "idle", message: "" }, approvalForm());

    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/approval blocked/i) });
    expect(assessRecommendationDistributionEligibility(preGateRecommendation as never, 7, null).eligible).toBe(false);
    expect(deps.reviews.recordDecision).not.toHaveBeenCalled();
  });

});
