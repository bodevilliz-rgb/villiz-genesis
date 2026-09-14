// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewPanel, getApprovalLabel } from "@/components/content/review-panel";
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
    hashtags: [],
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
    assignedReviewer: assignedReviewerId
      ? { id: assignedReviewerId, fullName: "Assigned Reviewer", email: "reviewer@villiz.com" }
      : null,
  };
}

describe("ReviewPanel — decision buttons on a freshly submitted (needs_review) draft", () => {
  it("shows Publish Now / Request changes / Reject to the reviewer this draft was assigned to", () => {
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

    expect(screen.getByText("Publish Now")).toBeInTheDocument();
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

    expect(screen.getByText("Publish Now")).toBeInTheDocument();
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

    expect(screen.queryByText("Publish Now")).toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
    expect(screen.getByText(/waiting on a lead or reviewer/i)).toBeInTheDocument();
  });

  it("does NOT block approval for non-critical distribution warnings", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("reviewer-1")}
        eligibleReviewers={[]}
        actorId="reviewer-1"
        canWrite={false}
        canLead={false}
        distributionApproval={{
          blocked: false,
          blockers: [],
          warnings: ["Consider reducing hashtag count"],
        }}
      />,
    );

    // Approval button should be enabled despite warnings
    expect(screen.getByRole("button", { name: "Publish Now" })).toBeEnabled();
    // Warnings heading should be displayed
    expect(screen.getByText(/distribution recommendation warnings/i)).toBeInTheDocument();
    // The specific warning text (appears in both warning box and Quality Details)
    const warningElements = screen.getAllByText(/Consider reducing hashtag count/);
    expect(warningElements.length).toBeGreaterThan(0);
  });

  it("blocks approval only for critical safety failures", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("reviewer-1")}
        eligibleReviewers={[]}
        actorId="reviewer-1"
        canWrite={false}
        canLead={false}
        distributionApproval={{
          blocked: true,
          blockers: ["no publishing destination"],
          warnings: ["Consider reducing hashtag count"],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Publish Now" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Critical safety check");
    expect(screen.getByRole("alert")).toHaveTextContent("no publishing destination");
  });

  it("allows approval when distribution checks pass with no warnings", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("reviewer-1")}
        eligibleReviewers={[]}
        actorId="reviewer-1"
        canWrite={false}
        canLead={false}
        distributionApproval={{
          blocked: false,
          blockers: [],
          warnings: [],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Publish Now" })).toBeEnabled();
  });
});

/**
 * Tests the simplified approval workflow — no more "Solo Operator Approval"
 * label. Instead, context-sensitive labels are used:
 * - "Publish Now" when no schedule is set
 * - "Approve & Schedule" when a future date is selected
 * - "Choose New Date" when the scheduled date has passed
 */
describe("getApprovalLabel", () => {
  it("returns 'Publish Now' for drafts without a scheduled date", () => {
    expect(getApprovalLabel({ scheduledAt: null } as ContentDraft)).toBe("Publish Now");
  });

  it("returns 'Approve & Schedule' for drafts with a future scheduled date", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    expect(getApprovalLabel({ scheduledAt: futureDate.toISOString() } as ContentDraft)).toBe("Approve & Schedule");
  });

  it("returns 'Choose New Date' for past scheduled dates", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    expect(getApprovalLabel({ scheduledAt: pastDate.toISOString() } as ContentDraft)).toBe("Choose New Date");
  });
});

describe("ReviewPanel — simplified approval workflow", () => {
  it("shows 'Publish Now' for drafts without a scheduled date", () => {
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

    expect(screen.getByText("Publish Now")).toBeInTheDocument();
  });

  it("shows 'Approve & Schedule' for drafts with a future scheduled date", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    const draftWithFutureSchedule = {
      ...needsReviewDraft("reviewer-1"),
      scheduledAt: futureDate.toISOString(),
    };

    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={draftWithFutureSchedule}
        eligibleReviewers={[]}
        actorId="reviewer-1"
        canWrite={false}
        canLead={false}
      />,
    );

    expect(screen.getByText("Approve & Schedule")).toBeInTheDocument();
  });

  it("removes 'Solo Operator Approval' terminology entirely", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("author-1")}
        eligibleReviewers={[]}
        actorId="author-1"
        canWrite={true}
        canLead={true}
      />,
    );

    expect(screen.queryByText(/solo operator approval/i)).toBeNull();
    // Self-authored drafts now use canLead for approval instead of solo approval
    expect(screen.getByText("Publish Now")).toBeInTheDocument();
  });
});

/**
 * Tests that material edits after approval invalidate the approval,
 * preserving version safety.
 */
describe("ReviewPanel — version safety", () => {
  it("shows warning when recommendation is for a stale draft version", () => {
    render(
      <ReviewPanel
        organisationId="00000000-0000-4000-8000-000000000001"
        draft={needsReviewDraft("reviewer-1")}
        eligibleReviewers={[]}
        actorId="reviewer-1"
        canWrite={false}
        canLead={false}
        distributionApproval={{
          blocked: false,
          blockers: [],
          warnings: ["Generate a new recommendation for the current draft version before publishing."],
        }}
      />,
    );

    expect(screen.getByText(/distribution recommendation warnings/i)).toBeInTheDocument();
    // Use getAllByText since the warning appears in both the warning section and Quality Details
    const warningElements = screen.getAllByText(/Generate a new recommendation for the current draft version before publishing/i);
    expect(warningElements.length).toBeGreaterThan(0);
  });
});
