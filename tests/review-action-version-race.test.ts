vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/core/application/use-cases/engagement", () => ({
  assessRecommendationDistributionEligibility: vi.fn(() => ({ eligible: true, score: 100, blockers: [] })),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordReviewDecisionAction } from "@/server/actions/review";
import { requireContext } from "@/server/container";
import { ValidationError } from "@/core/domain/errors";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000004";

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
        findLatest: vi.fn(async () => ({ draftVersion: 7 })),
        findLatestForDraftVersion: vi.fn(async () => ({ draftVersion: 7 })),
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
