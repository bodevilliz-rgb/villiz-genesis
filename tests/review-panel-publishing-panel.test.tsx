// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewPanel } from "@/components/content/review-panel";
import type { ContentDraft } from "@/core/domain/entities/content";

/**
 * Regression test for the Sprint 6A.1 duplicate-panel fix: Content Studio's
 * draft page used to show publishing controls twice — once from its own
 * direct `<PublishingPanel />` render, and once nested inside `ReviewPanel`
 * under a second "Publishing Actions" heading. `ReviewPanel` no longer
 * renders `PublishingPanel` at all; the draft page's own render is the only
 * one left. This asserts that directly against `ReviewPanel` in isolation,
 * since that is the component the duplication actually lived in.
 */

function approvedDraft(): ContentDraft {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    organisationId: "00000000-0000-4000-8000-000000000001",
    title: "A draft",
    contentType: "social_post",
    summary: null,
    body: "Body",
    status: "approved",
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    dueAt: null,
    reviewerIds: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    createdBy: { id: "author-1", fullName: "Author One", email: "author@villiz.com" },
    updatedBy: { id: "author-1", fullName: "Author One", email: "author@villiz.com" },
    priority: "medium",
    reviewDeadline: null,
  };
}

describe("ReviewPanel — no embedded PublishingPanel", () => {
  it("does not render a 'Publishing Actions' heading or a Publish Now / Schedule control for an approved draft", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={approvedDraft()}
        eligibleReviewers={[]}
        actorId="actor-1"
        canWrite={true}
        canApprove={true}
        canLead={true}
      />,
    );

    expect(screen.queryByText(/publishing actions/i)).toBeNull();
    expect(screen.queryByText(/publish now/i)).toBeNull();
    expect(screen.queryByText(/^schedule$/i)).toBeNull();
    // The review-decision surface it IS responsible for should still be there.
    expect(screen.getByText(/reopen review/i)).toBeInTheDocument();
  });
});
