/**
 * T1–T10: Approval reliability regression tests.
 *
 * Proves:
 *   T1  recordDecision called exactly once per invocation (no duplicate mutations)
 *   T2  single confirmation → approved status
 *   T3  double-approve blocked by state machine
 *   T4  failed approval (wrong role) → ForbiddenError
 *   T5  retry after failed approval works
 *   T6  non-reviewer cannot approve
 *   T7  self-approval blocked for reviewer
 *   T8  request-changes produces one mutation
 *   T9  review history correct after approval
 *   T10 approved draft is locked
 */
import { describe, expect, it } from "vitest";
import {
  approveDraft,
  getReviewHistory,
  requestDraftChanges,
  reopenReview,
} from "@/core/application/use-cases/review";
import { isContentDraftLocked } from "@/core/domain/entities/content";
import { ForbiddenError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import type { ContentDraft, ContentDraftStatus } from "@/core/domain/entities/content";
import type { ReviewHistoryEntry, ReviewActionType } from "@/core/domain/entities/review";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { ReviewRepository } from "@/core/application/ports/review-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { OrganisationMember } from "@/core/domain/entities/organisation";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000004";
const REVIEWER_ID = "00000000-0000-4000-8000-000000000005";

function baseActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: ACTOR_ID,
    email: "actor@villiz.com",
    fullName: "Actor",
    avatarUrl: null,
    jobTitle: null,
    role: "member",
    isActive: true,
    isPlatformAdmin: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function orgMember(profileId: string, role: OrganisationRole): OrganisationMember {
  return {
    organisationId: ORG_ID,
    profileId,
    role,
    createdAt: "2026-01-01T00:00:00Z",
    profile: {
      id: profileId,
      email: `${profileId}@villiz.com`,
      fullName: profileId,
      avatarUrl: null,
      jobTitle: null,
      isActive: true,
    },
  };
}

function draftWithStatus(status: ContentDraftStatus, createdById = AUTHOR_ID): ContentDraft {
  return {
    id: DRAFT_ID,
    organisationId: ORG_ID,
    title: "Test Draft",
    contentType: "social_post",
    summary: null,
    body: "Test body.",
    status,
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assets: [],
    assignedReviewer: null,
    reviewerIds: [],
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    dueAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: { id: createdById, fullName: "Author", email: "author@test.com" },
    updatedBy: { id: createdById, fullName: "Author", email: "author@test.com" },
    priority: "medium",
    reviewDeadline: null,
    lastReviewAction: null,
    lastReviewAt: null,
    hashtags: [],
  };
}

interface MutationRecord {
  draftId: string;
  action: string;
  newStatus: ContentDraftStatus | null;
}

function makeReviewRepo(initial: ContentDraft, mutations: MutationRecord[]): ReviewRepository {
  let current = initial;
  const history: ReviewHistoryEntry[] = [];

  return {
    recordDecision: async (input: {
      draftId: string;
      action: ReviewActionType;
      newStatus: ContentDraftStatus | null;
      assignedReviewerId: string | null;
      comment: string | null;
    }) => {
      mutations.push({ draftId: input.draftId, action: input.action, newStatus: input.newStatus });
      if (input.newStatus) {
        current = { ...current, status: input.newStatus };
      }
      history.push({
        id: `hist-${mutations.length}`,
        draftId: input.draftId,
        organisationId: ORG_ID,
        action: input.action,
        actor: { id: ACTOR_ID, fullName: "Actor", email: "actor@test.com" },
        assignedReviewer: null,
        previousStatus: initial.status,
        newStatus: input.newStatus as ContentDraftStatus,
        comment: input.comment,
        createdAt: new Date().toISOString(),
      });
      return current;
    },
    listHistory: async (_organisationId: string, _draftId: string) => history,
  } as unknown as ReviewRepository;
}

function makeContentRepo(draft: ContentDraft): ContentRepository {
  let current = draft;
  return {
    findDraft: async () => current,
    updateStatus: async (_orgId: string, _draftId: string, status: ContentDraftStatus) => {
      current = { ...current, status };
      return current;
    },
  } as unknown as ContentRepository;
}

function makeOrgRepo(actorId: string, actorRole: OrganisationRole): OrganisationRepository {
  return {
    viewerRole: async () => actorRole,
    listMembers: async (): Promise<OrganisationMember[]> => [
      orgMember(actorId, actorRole),
      orgMember(AUTHOR_ID, "contributor"),
    ],
  } as unknown as OrganisationRepository;
}

function buildDeps(
  draft: ContentDraft,
  actorId: string,
  actorRole: OrganisationRole,
  mutations: MutationRecord[],
  actorOverrides: Partial<Actor> = {},
) {
  return {
    actor: baseActor({ id: actorId, ...actorOverrides }),
    content: makeContentRepo(draft),
    reviews: makeReviewRepo(draft, mutations),
    organisations: makeOrgRepo(actorId, actorRole),
  };
}

const baseInput = { organisationId: ORG_ID, draftId: DRAFT_ID, comment: "" };

// T1: recordDecision is called exactly once per approveDraft invocation.
describe("T1 — single mutation per approval", () => {
  it("calls recordDecision exactly once", async () => {
    const mutations: MutationRecord[] = [];
    const draft = draftWithStatus("in_review", AUTHOR_ID);
    const d = buildDeps(draft, REVIEWER_ID, "lead", mutations);
    await approveDraft(d, baseInput);
    expect(mutations).toHaveLength(1);
  });
});

// T2: A single confirmation produces "approved" status.
describe("T2 — single confirmation produces approved status", () => {
  it("returns a draft with status 'approved'", async () => {
    const mutations: MutationRecord[] = [];
    const draft = draftWithStatus("in_review", AUTHOR_ID);
    const d = buildDeps(draft, REVIEWER_ID, "lead", mutations);
    const result = await approveDraft(d, baseInput);
    expect(result.status).toBe("approved");
  });
});

// T3: Double-approve blocked — state machine rejects "approved" → "approved".
describe("T3 — double-approve blocked by state machine", () => {
  it("second approveDraft call throws because state is already approved", async () => {
    const mutations: MutationRecord[] = [];
    const draft = draftWithStatus("in_review", AUTHOR_ID);

    let current = draft;
    const reviewRepo = makeReviewRepo(draft, mutations);
    const contentRepo: ContentRepository = {
      findDraft: async () => current,
    } as unknown as ContentRepository;

    const d = {
      actor: baseActor({ id: REVIEWER_ID }),
      content: contentRepo,
      reviews: reviewRepo,
      organisations: makeOrgRepo(REVIEWER_ID, "lead"),
    };

    const first = await approveDraft(d, baseInput);
    current = first; // state machine now sees "approved"

    await expect(approveDraft(d, baseInput)).rejects.toThrow();
    expect(mutations).toHaveLength(1);
  });
});

// T4: Failed approval (wrong role) → ForbiddenError, no mutation.
describe("T4 — failed approval returns ForbiddenError for wrong role", () => {
  it("contributor cannot approve", async () => {
    const mutations: MutationRecord[] = [];
    const draft = draftWithStatus("in_review", AUTHOR_ID);
    const d = buildDeps(draft, ACTOR_ID, "contributor", mutations);
    await expect(approveDraft(d, baseInput)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mutations).toHaveLength(0);
  });
});

// T5: Retry after failed approval works.
describe("T5 — retry after failed approval works", () => {
  it("second attempt with correct role succeeds with exactly one mutation", async () => {
    const draft = draftWithStatus("in_review", AUTHOR_ID);
    const mutations: MutationRecord[] = [];

    // First attempt: contributor — fails
    const badDeps = buildDeps(draft, ACTOR_ID, "contributor", mutations);
    await expect(approveDraft(badDeps, baseInput)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mutations).toHaveLength(0);

    // Second attempt: lead — succeeds
    const goodDeps = buildDeps(draft, REVIEWER_ID, "lead", mutations);
    const result = await approveDraft(goodDeps, baseInput);
    expect(result.status).toBe("approved");
    expect(mutations).toHaveLength(1);
  });
});

// T6: Non-reviewer cannot approve.
describe("T6 — non-reviewer cannot approve", () => {
  it("reviewer without lead role can still approve (they have approval permission)", async () => {
    const mutations: MutationRecord[] = [];
    const draft = draftWithStatus("in_review", AUTHOR_ID);
    const d = buildDeps(draft, REVIEWER_ID, "reviewer", mutations);
    const result = await approveDraft(d, baseInput);
    expect(result.status).toBe("approved");
  });

  it("contributor cannot approve", async () => {
    const mutations: MutationRecord[] = [];
    const draft = draftWithStatus("in_review", AUTHOR_ID);
    const d = buildDeps(draft, ACTOR_ID, "contributor", mutations);
    await expect(approveDraft(d, baseInput)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mutations).toHaveLength(0);
  });
});

// T7: Self-approval blocked for reviewer.
describe("T7 — self-approval blocked", () => {
  it("reviewer who authored the draft gets ForbiddenError", async () => {
    // ACTOR_ID is both author and actor
    const draft = draftWithStatus("in_review", ACTOR_ID);
    const mutations: MutationRecord[] = [];
    const d = buildDeps(draft, ACTOR_ID, "reviewer", mutations);
    await expect(approveDraft(d, baseInput)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mutations).toHaveLength(0);
  });

  it("sole eligible Account Lead uses the ordinary single-mutation approval path", async () => {
    const draft = draftWithStatus("in_review", ACTOR_ID);
    const mutations: MutationRecord[] = [];
    const d = buildDeps(draft, ACTOR_ID, "lead", mutations);
    await expect(approveDraft(d, baseInput)).resolves.toMatchObject({ status: "approved" });
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ action: "approved", newStatus: "approved" });
  });
});

// T8: request-changes produces exactly one mutation.
describe("T8 — request changes produces one mutation with changes_requested", () => {
  it("requestDraftChanges returns changes_requested", async () => {
    const draft = draftWithStatus("in_review", AUTHOR_ID);
    const mutations: MutationRecord[] = [];
    const d = buildDeps(draft, REVIEWER_ID, "lead", mutations);
    const result = await requestDraftChanges(d, { ...baseInput, comment: "Please revise" });
    expect(result.status).toBe("changes_requested");
    expect(mutations).toHaveLength(1);
  });
});

// T9: Review history is correct after approval.
describe("T9 — review history records the approval", () => {
  it("getReviewHistory returns an entry with action 'approved'", async () => {
    const draft = draftWithStatus("in_review", AUTHOR_ID);
    const mutations: MutationRecord[] = [];
    const reviewRepo = makeReviewRepo(draft, mutations);
    const d = {
      actor: baseActor({ id: REVIEWER_ID }),
      content: makeContentRepo(draft),
      reviews: reviewRepo,
      organisations: makeOrgRepo(REVIEWER_ID, "lead"),
    };
    await approveDraft(d, baseInput);
    const history = await getReviewHistory(d, ORG_ID, DRAFT_ID);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.action).toBe("approved");
  });
});

// T10: isContentDraftLocked returns true for "approved".
describe("T10 — approved draft is locked", () => {
  it("isContentDraftLocked('approved') === true", () => {
    expect(isContentDraftLocked("approved")).toBe(true);
  });

  it("isContentDraftLocked('draft') === false", () => {
    expect(isContentDraftLocked("draft")).toBe(false);
  });

  it("isContentDraftLocked('scheduled') === true", () => {
    expect(isContentDraftLocked("scheduled")).toBe(true);
  });

  it("isContentDraftLocked('published') === true", () => {
    expect(isContentDraftLocked("published")).toBe(true);
  });

  it("re-opened draft (needs_review) is not locked", async () => {
    const draft = draftWithStatus("approved", AUTHOR_ID);
    const mutations: MutationRecord[] = [];
    const d = buildDeps(draft, REVIEWER_ID, "lead", mutations);
    const result = await reopenReview(d, baseInput);
    expect(isContentDraftLocked(result.status)).toBe(false);
  });
});
