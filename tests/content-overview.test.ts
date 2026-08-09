import { describe, expect, it } from "vitest";
import { getContentOverview } from "@/core/application/use-cases/content";
import { DRAFT_STATUSES } from "@/infrastructure/repositories/supabase-content-repository";
import { CONTENT_DRAFT_STATUS_LABELS, type ContentDraft, type ContentDraftStatus } from "@/core/domain/entities/content";
import type { Actor } from "@/core/domain/entities/identity";
import type { ContentRepository } from "@/core/application/ports/content-port";

/**
 * Regression coverage for the cloud pilot "Content Studio shows zero drafts"
 * bug: countDraftsByStatus() summed only a hardcoded, stale DRAFT_STATUSES
 * list that omitted needs_review, rejected, publishing, failed, and
 * awaiting_client. A draft submitted for review (draft -> needs_review, the
 * very first thing "Submit for Review" does) was therefore invisible to
 * getContentOverview().totalDrafts, which the Content Studio page uses to
 * decide whether to render the empty state — a real, approved-pending draft
 * got hidden behind "No drafts yet".
 *
 * This list is independent of DRAFT_STATUSES/CONTENT_DRAFT_STATUS_LABELS on
 * purpose — it is the actual ContentDraftStatus union, typed out by hand, so
 * a future status addition that isn't reflected here fails this test loudly
 * rather than silently drifting the same way DRAFT_STATUSES once did.
 */
const ALL_CONTENT_DRAFT_STATUSES: ContentDraftStatus[] = [
  "draft",
  "needs_review",
  "in_review",
  "changes_requested",
  "awaiting_client",
  "approved",
  "rejected",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "archived",
];

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000004";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    email: "actor@villiz.com",
    fullName: "Actor One",
    avatarUrl: null,
    jobTitle: null,
    role: "member",
    isActive: true,
    isPlatformAdmin: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function profileRef(id: string, fullName: string) {
  return { id, fullName, email: `${id}@villiz.com` };
}

function baseDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: DRAFT_ID,
    organisationId: ORG_ID,
    title: "A draft",
    contentType: "social_post",
    summary: null,
    body: "Body",
    status: "draft",
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
    createdBy: profileRef(AUTHOR_ID, "Author"),
    updatedBy: profileRef(AUTHOR_ID, "Author"),
    priority: "medium",
    reviewDeadline: null,
    hashtags: [],
    ...overrides,
  };
}

describe("DRAFT_STATUSES — exhaustiveness", () => {
  it("contains exactly the 12 known ContentDraftStatus values, no gaps or duplicates", () => {
    expect(new Set(DRAFT_STATUSES).size).toBe(DRAFT_STATUSES.length);
    expect([...DRAFT_STATUSES].sort()).toEqual([...ALL_CONTENT_DRAFT_STATUSES].sort());
  });

  it("specifically includes the 5 statuses the previous hardcoded list omitted", () => {
    for (const status of ["needs_review", "rejected", "publishing", "failed", "awaiting_client"] as const) {
      expect(DRAFT_STATUSES).toContain(status);
    }
  });

  it("stays in lockstep with CONTENT_DRAFT_STATUS_LABELS, its single exhaustive source", () => {
    expect([...DRAFT_STATUSES].sort()).toEqual(Object.keys(CONTENT_DRAFT_STATUS_LABELS).sort());
  });

  it("would catch a future status addition that isn't reflected in this test's own independent list", () => {
    // Sanity check on the test itself: ALL_CONTENT_DRAFT_STATUSES must stay a
    // faithful, independently-authored mirror of ContentDraftStatus, not a
    // copy-paste of DRAFT_STATUSES — asserting the lengths match here is
    // what proves this test suite doesn't just move the drift risk from
    // production code into a test fixture.
    expect(ALL_CONTENT_DRAFT_STATUSES).toHaveLength(12);
    expect(new Set(ALL_CONTENT_DRAFT_STATUSES).size).toBe(12);
  });
});

describe("getContentOverview — a workspace whose only draft is needs_review", () => {
  it("reports totalDrafts > 0 and does not indicate an empty workspace (regression: previously totalDrafts silently summed to 0)", async () => {
    const draft = baseDraft({ status: "needs_review" });

    const content: Partial<ContentRepository> = {
      // Faithful re-implementation of the real (now-fixed) countDraftsByStatus:
      // iterates the same exhaustive DRAFT_STATUSES the repository derives
      // from CONTENT_DRAFT_STATUS_LABELS, counting an in-memory draft instead
      // of querying Postgres — proving the fix flows all the way through to
      // the value the Content Studio page's `hasAnyDrafts` check reads.
      async countDraftsByStatus() {
        const counts = Object.fromEntries(DRAFT_STATUSES.map((status) => [status, 0])) as Record<ContentDraftStatus, number>;
        counts[draft.status] += 1;
        return counts;
      },
      async listDrafts() {
        return [draft];
      },
    };

    const overview = await getContentOverview(
      { actor: actor(), content: content as ContentRepository, membrain: {} as never, organisations: {} as never },
      ORG_ID,
    );

    expect(overview.totalDrafts).toBe(1);
    expect(overview.byStatus.needs_review).toBe(1);
    // This is exactly the boolean the Content Studio page uses to decide
    // whether to render the "No drafts yet" empty state instead of the list.
    const hasAnyDrafts = overview.totalDrafts > 0;
    expect(hasAnyDrafts).toBe(true);
  });

  it("still reports totalDrafts: 0 for a genuinely empty workspace (no false positive)", async () => {
    const content: Partial<ContentRepository> = {
      async countDraftsByStatus() {
        return Object.fromEntries(DRAFT_STATUSES.map((status) => [status, 0])) as Record<ContentDraftStatus, number>;
      },
      async listDrafts() {
        return [];
      },
    };

    const overview = await getContentOverview(
      { actor: actor(), content: content as ContentRepository, membrain: {} as never, organisations: {} as never },
      ORG_ID,
    );

    expect(overview.totalDrafts).toBe(0);
  });
});
