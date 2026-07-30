import { describe, expect, it } from "vitest";
import {
  canApproveOwnAuthorship,
  findReviewTransition,
  REVIEW_TRANSITIONS,
  type ReviewTransition,
} from "@/core/domain/entities/review";
import type { ContentDraftStatus } from "@/core/domain/entities/content";

const ALL_STATUSES: ContentDraftStatus[] = ["draft", "needs_review", "approved", "rejected"];

function find(from: ContentDraftStatus, to: ContentDraftStatus): ReviewTransition | null {
  return findReviewTransition(from, to);
}

describe("REVIEW_TRANSITIONS", () => {
  it("allows submitting a draft for review, unrestricted and no comment", () => {
    const t = find("draft", "needs_review");
    expect(t).toMatchObject({ action: "submitted", requiresLead: false, commentRequired: false });
  });

  it("allows approving a reviewed draft, no comment required", () => {
    const t = find("needs_review", "approved");
    expect(t).toMatchObject({ action: "approved", requiresLead: false, commentRequired: false });
  });

  it("allows sending a reviewed draft back to draft, comment required", () => {
    const t = find("needs_review", "draft");
    expect(t).toMatchObject({ action: "changes_requested", requiresLead: false, commentRequired: true });
  });

  it("allows rejecting a reviewed draft, comment required", () => {
    const t = find("needs_review", "rejected");
    expect(t).toMatchObject({ action: "rejected", requiresLead: false, commentRequired: true });
  });

  it("allows a Lead to reopen an approved draft back into review", () => {
    const t = find("approved", "needs_review");
    expect(t).toMatchObject({ action: "reopened", requiresLead: true, commentRequired: false });
  });

  it("allows a Lead to reopen a rejected draft back to editable draft", () => {
    const t = find("rejected", "draft");
    expect(t).toMatchObject({ action: "reopened", requiresLead: true, commentRequired: false });
  });

  it("rejects every transition not explicitly listed", () => {
    const valid = new Set(REVIEW_TRANSITIONS.map((t) => `${t.from}->${t.to}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (valid.has(`${from}->${to}`)) continue;
        expect(find(from, to)).toBeNull();
      }
    }
  });

  it("rejects skipping straight from draft to approved or rejected", () => {
    expect(find("draft", "approved")).toBeNull();
    expect(find("draft", "rejected")).toBeNull();
  });

  it("rejects a no-op transition to the same status for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(find(status, status)).toBeNull();
    }
  });

  it("rejects reopening a rejected draft straight to needs_review, or an approved draft straight to draft", () => {
    expect(find("rejected", "needs_review")).toBeNull();
    expect(find("approved", "draft")).toBeNull();
  });
});

describe("canApproveOwnAuthorship", () => {
  it("forbids an actor from approving a draft they authored", () => {
    expect(canApproveOwnAuthorship("actor-1", "actor-1")).toBe(false);
  });

  it("allows an actor to approve a draft authored by someone else", () => {
    expect(canApproveOwnAuthorship("actor-1", "actor-2")).toBe(true);
  });

  it("allows approval when the draft has no recorded author", () => {
    expect(canApproveOwnAuthorship("actor-1", null)).toBe(true);
  });
});
