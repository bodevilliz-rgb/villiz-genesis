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

/**
 * Sprint 6C regression: submitForReview() lands a fresh submission on
 * "needs_review", not "in_review" — both display as "In review" (see
 * CONTENT_DRAFT_STATUS_LABELS), so a real submitted draft always has status
 * "needs_review" and the panel must still show Approve/Reject/Request
 * changes for it. It previously checked draft.status === "in_review" only,
 * which silently hid the buttons for every draft that had just gone through
 * Submit for review.
 */
function needsReviewDraft(assignedReviewerId: string | null): ContentDraft {
  return {
    ...approvedDraft(),
    status: "needs_review",
    createdBy: { id: "author-1", fullName: "Author One", email: "author@villiz.com" },
    assignedReviewer: assignedReviewerId
      ? { id: assignedReviewerId, fullName: "Assigned Reviewer", email: "reviewer@villiz.com" }
      : null,
  };
}

describe("ReviewPanel — decision buttons on a freshly submitted (needs_review) draft", () => {
  it("shows Approve / Request changes / Reject to the reviewer this draft was assigned to", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("reviewer-1")}
        eligibleReviewers={[]}
        actorId="reviewer-1"
        canWrite={false}
        canLead={false}
      />,
    );

    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
  });

  it("shows the decision buttons to an Account Lead even when the draft is assigned to someone else", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("someone-else")}
        eligibleReviewers={[]}
        actorId="lead-1"
        canWrite={true}
        canLead={true}
      />,
    );

    expect(screen.getByText("Approve")).toBeInTheDocument();
  });

  it("hides the decision buttons from a viewer who is neither the assigned reviewer nor an Account Lead", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("someone-else")}
        eligibleReviewers={[]}
        actorId="bystander-1"
        canWrite={false}
        canLead={false}
      />,
    );

    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
    expect(screen.getByText(/waiting on a lead or reviewer/i)).toBeInTheDocument();
  });
});

/**
 * Regression coverage for the CLOUD_PILOT_SELF_APPROVAL UI fix: ReviewPanel
 * used to hide DecisionForm for any self-authored draft unconditionally,
 * with no awareness of the server-side bypass — so even when
 * canBypassSelfApprovalForCloudPilot() (use-cases/review/index.ts) would
 * genuinely allow the approval, the buttons never appeared and no request
 * was ever sent. canSelfApproveInCloudPilot is computed server-side by that
 * exact function and passed down as a plain boolean prop; ReviewPanel does
 * not re-derive or duplicate any of the four bypass conditions itself.
 */
describe("ReviewPanel — canSelfApproveInCloudPilot prop", () => {
  it("self-authored + canSelfApproveInCloudPilot=true: shows DecisionForm, not the warning", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("author-1")}
        eligibleReviewers={[]}
        actorId="author-1"
        canWrite={true}
        canLead={true}
        canSelfApproveInCloudPilot={true}
      />,
    );

    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.queryByText(/you cannot approve, request changes on, or archive your own draft/i)).toBeNull();
  });

  it("self-authored + canSelfApproveInCloudPilot=false (the default, and every local-development case): shows the warning, not DecisionForm", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("author-1")}
        eligibleReviewers={[]}
        actorId="author-1"
        canWrite={true}
        canLead={true}
        // canSelfApproveInCloudPilot omitted — defaults to false, matching
        // every existing caller and local dev, which never sets the flag.
      />,
    );

    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
    expect(screen.getByText(/you cannot approve, request changes on, or archive your own draft/i)).toBeInTheDocument();
  });

  it("non-self-authored: shows DecisionForm regardless of canSelfApproveInCloudPilot (multi-user organisations unaffected)", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("reviewer-1")}
        eligibleReviewers={[]}
        actorId="reviewer-1"
        canWrite={false}
        canLead={false}
        canSelfApproveInCloudPilot={false}
      />,
    );

    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.queryByText(/you cannot approve, request changes on, or archive your own draft/i)).toBeNull();
  });
});
