import { afterEach, describe, expect, it } from "vitest";
import {
  approveDraft,
  assignReviewer,
  canBypassSelfApprovalForCloudPilot,
  getReviewHistory,
  rejectDraft,
  reopenReview,
  requestDraftChanges,
  submitForReview,
} from "@/core/application/use-cases/review";
import { ForbiddenError, ValidationError } from "@/core/domain/errors";
import type { Actor, OrganisationRole, PlatformRole } from "@/core/domain/entities/identity";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { ReviewHistoryEntry } from "@/core/domain/entities/review";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { ReviewRepository } from "@/core/application/ports/review-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { OrganisationMember } from "@/core/domain/entities/organisation";

// The DTOs validate every id as a UUID, so fixtures need real UUID-shaped
// strings rather than readable slugs like "org-1" — these are fixed rather
// than random purely so a failing assertion is easy to read.
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const AUTHOR_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_AUTHOR_ID = "00000000-0000-4000-8000-000000000005";
const REVIEWER_ID = "00000000-0000-4000-8000-000000000006";
const REVIEWER_2_ID = "00000000-0000-4000-8000-000000000007";
const CONTRIBUTOR_ID = "00000000-0000-4000-8000-000000000008";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: ACTOR_ID,
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

function member(profileId: string, role: OrganisationRole, platformRole?: PlatformRole, isActive = true): OrganisationMember {
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
      isActive,
      platformRole,
    },
  };
}

/**
 * A minimal in-memory workflow harness — not a general-purpose fake
 * repository layer (this codebase's other tests exercise pure functions
 * directly), but the review use-cases' permission gates, reviewer
 * eligibility check, and reassignment detection only exist at this layer,
 * so this is the only way to genuinely test them. Only the methods the
 * review use-cases actually call are implemented; everything else on the
 * interfaces is intentionally left unimplemented.
 */
function createHarness(input: {
  draft: ContentDraft;
  viewerRole: OrganisationRole | null;
  members: OrganisationMember[];
  actorOverrides?: Partial<Actor>;
}) {
  let draft = input.draft;
  const history: ReviewHistoryEntry[] = [];

  const content: Partial<ContentRepository> = {
    async findDraft() {
      return draft;
    },
  };

  const reviews: Partial<ReviewRepository> = {
    async recordDecision(decision) {
      const previousStatus = draft.status;
      draft = {
        ...draft,
        status: decision.newStatus ?? draft.status,
        assignedReviewer:
          decision.action === "assigned" || decision.action === "reassigned"
            ? profileRef(decision.assignedReviewerId!, decision.assignedReviewerId!)
            : draft.assignedReviewer,
        lastReviewAction: decision.action,
      };
      history.push({
        id: `history-${history.length + 1}`,
        draftId: draft.id,
        organisationId: draft.organisationId,
        action: decision.action,
        actor: profileRef(ACTOR_ID, "Current actor"),
        assignedReviewer: decision.assignedReviewerId ? profileRef(decision.assignedReviewerId, decision.assignedReviewerId) : null,
        previousStatus,
        newStatus: draft.status,
        comment: decision.comment,
        createdAt: new Date(2026, 0, 1, 0, 0, history.length).toISOString(),
      });
      return draft;
    },
    async listHistory() {
      // Mirrors the real repository's `order("created_at", { ascending: false })`.
      return [...history].reverse();
    },
  };

  const organisations: Partial<OrganisationRepository> = {
    async viewerRole() {
      return input.viewerRole;
    },
    async listMembers() {
      return input.members;
    },
  };

  return {
    deps: {
      actor: actor(input.actorOverrides),
      content: content as ContentRepository,
      reviews: reviews as ReviewRepository,
      organisations: organisations as OrganisationRepository,
    },
    getDraft: () => draft,
    getHistory: () => history,
  };
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

const request = { organisationId: ORG_ID, draftId: DRAFT_ID };

describe("submitForReview", () => {
  it("moves a draft into needs_review for any contributor", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft(), viewerRole: "contributor", members: [] });
    await submitForReview(deps, request);
    expect(getDraft().status).toBe("needs_review");
  });

  it("refuses a contributor with no role on the account", async () => {
    const { deps } = createHarness({ draft: baseDraft(), viewerRole: null, members: [] });
    await expect(submitForReview(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to submit a draft that is not currently in draft status", async () => {
    const { deps } = createHarness({
      draft: baseDraft({ status: "needs_review" }),
      viewerRole: "contributor",
      members: [],
    });
    await expect(submitForReview(deps, request)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("approveDraft — self-approval prevention", () => {
  it("forbids the draft's own author, who happens to be a Lead, from approving it", async () => {
    const { deps } = createHarness({
      draft: baseDraft({ status: "needs_review", createdBy: profileRef(ACTOR_ID, "Actor One") }),
      viewerRole: "lead",
      members: [],
    });
    await expect(approveDraft(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows a different Lead or Reviewer to approve the same draft (needs_review -> approved)", async () => {
    const { deps, getDraft } = createHarness({
      draft: baseDraft({ status: "needs_review", createdBy: profileRef(AUTHOR_ID, "Author") }),
      viewerRole: "reviewer",
      members: [],
    });
    await approveDraft(deps, request);
    expect(getDraft().status).toBe("approved");
  });

  it("allows a different Lead or Reviewer to approve an in_review draft (regression test)", async () => {
    const { deps, getDraft } = createHarness({
      draft: baseDraft({ status: "in_review", createdBy: profileRef(AUTHOR_ID, "Author") }),
      viewerRole: "reviewer",
      members: [],
    });
    await approveDraft(deps, request);
    expect(getDraft().status).toBe("approved");
  });

  it("refuses a contributor attempting to approve, self-authored or not", async () => {
    const { deps } = createHarness({
      draft: baseDraft({ status: "needs_review", createdBy: profileRef(OTHER_AUTHOR_ID, "Someone") }),
      viewerRole: "contributor",
      members: [],
    });
    await expect(approveDraft(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/**
 * CLOUD_PILOT_SELF_APPROVAL — every one of the four gates (flag, cloud
 * environment, actor.role === "owner", isSoleOwnerPilotOrganisation) is
 * tested independently as the one thing NOT satisfied, proving the bypass
 * only ever fires when all four hold simultaneously. Restores process.env
 * after every test so this can never leak into an unrelated test file.
 */
describe("approveDraft — CLOUD_PILOT_SELF_APPROVAL bypass", () => {
  const CLOUD_URL = "https://pxygyzgzkqjludwxtgbz.supabase.co";
  const LOCAL_URL = "http://127.0.0.1:54321";
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const selfAuthoredDraft = () => baseDraft({ status: "needs_review", createdBy: profileRef(ACTOR_ID, "Actor One") });
  const soleOwnerMembers = () => [member(ACTOR_ID, "lead", "owner")];

  it("flag off (the default): still forbidden even though every other condition holds", async () => {
    delete process.env.CLOUD_PILOT_SELF_APPROVAL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;
    const { deps } = createHarness({
      draft: selfAuthoredDraft(),
      viewerRole: "lead",
      members: soleOwnerMembers(),
      actorOverrides: { role: "owner" },
    });
    await expect(approveDraft(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("flag on but environment is local: still forbidden", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_URL;
    const { deps } = createHarness({
      draft: selfAuthoredDraft(),
      viewerRole: "lead",
      members: soleOwnerMembers(),
      actorOverrides: { role: "owner" },
    });
    await expect(approveDraft(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("flag on, cloud environment, but actor's platform role is not owner: still forbidden", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;
    const { deps } = createHarness({
      draft: selfAuthoredDraft(),
      viewerRole: "lead",
      members: [member(ACTOR_ID, "lead", "admin")],
      actorOverrides: { role: "admin" },
    });
    await expect(approveDraft(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("flag on, cloud environment, owner role, but another reviewer exists on the organisation: still forbidden", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;
    const { deps } = createHarness({
      draft: selfAuthoredDraft(),
      viewerRole: "lead",
      members: [member(ACTOR_ID, "lead", "owner"), member(REVIEWER_ID, "reviewer", "member")],
      actorOverrides: { role: "owner" },
    });
    await expect(approveDraft(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("flag on, cloud environment, owner role, but two active owners exist: still forbidden", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;
    const { deps } = createHarness({
      draft: selfAuthoredDraft(),
      viewerRole: "lead",
      members: [member(ACTOR_ID, "lead", "owner"), member(REVIEWER_2_ID, "contributor", "owner")],
      actorOverrides: { role: "owner" },
    });
    await expect(approveDraft(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("flag on, cloud environment, owner role, an inactive second owner does not count against sole-owner status", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;
    const { deps, getDraft } = createHarness({
      draft: selfAuthoredDraft(),
      viewerRole: "lead",
      members: [member(ACTOR_ID, "lead", "owner"), member(REVIEWER_2_ID, "contributor", "owner", false)],
      actorOverrides: { role: "owner" },
    });
    await approveDraft(deps, request);
    expect(getDraft().status).toBe("approved");
  });

  it("all four conditions hold: the sole Owner may approve their own draft, and the ordinary decision/history path runs exactly as any other approval", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;
    const { deps, getDraft, getHistory } = createHarness({
      draft: selfAuthoredDraft(),
      viewerRole: "lead",
      members: soleOwnerMembers(),
      actorOverrides: { role: "owner" },
    });

    await approveDraft(deps, request);

    expect(getDraft().status).toBe("approved");
    expect(getHistory()).toHaveLength(1);
    expect(getHistory()[0]!.action).toBe("approved");
    expect(getHistory()[0]!.newStatus).toBe("approved");
  });
});

/**
 * Direct coverage of canBypassSelfApprovalForCloudPilot (use-cases/review/
 * index.ts) — the exact function applyTransition calls to actually enforce
 * the bypass, and the draft detail page calls to compute the
 * canSelfApproveInCloudPilot prop it passes to ReviewPanel. Testing it
 * directly proves the server remains the real authority regardless of what
 * the UI does with the resulting boolean.
 */
describe("canBypassSelfApprovalForCloudPilot — direct coverage of the shared bypass function", () => {
  const CLOUD_URL = "https://pxygyzgzkqjludwxtgbz.supabase.co";
  const LOCAL_URL = "http://127.0.0.1:54321";
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function fakeOrganisations(members: OrganisationMember[]): OrganisationRepository {
    const organisations: Partial<OrganisationRepository> = {
      async listMembers() {
        return members;
      },
    };
    return organisations as OrganisationRepository;
  }

  it("returns false when CLOUD_PILOT_SELF_APPROVAL is off, even with every other condition satisfied", async () => {
    delete process.env.CLOUD_PILOT_SELF_APPROVAL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;

    const result = await canBypassSelfApprovalForCloudPilot(
      { actor: actor({ role: "owner" }), organisations: fakeOrganisations([member(ACTOR_ID, "lead", "owner")]) },
      ORG_ID,
    );

    expect(result).toBe(false);
  });

  it("returns false outside the cloud environment", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_URL;

    const result = await canBypassSelfApprovalForCloudPilot(
      { actor: actor({ role: "owner" }), organisations: fakeOrganisations([member(ACTOR_ID, "lead", "owner")]) },
      ORG_ID,
    );

    expect(result).toBe(false);
  });

  it("returns false when the actor's platform role is not owner", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;

    const result = await canBypassSelfApprovalForCloudPilot(
      { actor: actor({ role: "admin" }), organisations: fakeOrganisations([member(ACTOR_ID, "lead", "admin")]) },
      ORG_ID,
    );

    expect(result).toBe(false);
  });

  it("returns false when the organisation is not a sole-owner organisation (another reviewer exists)", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;

    const result = await canBypassSelfApprovalForCloudPilot(
      {
        actor: actor({ role: "owner" }),
        organisations: fakeOrganisations([member(ACTOR_ID, "lead", "owner"), member(REVIEWER_ID, "reviewer", "member")]),
      },
      ORG_ID,
    );

    expect(result).toBe(false);
  });

  it("returns true only when all four conditions hold", async () => {
    process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = CLOUD_URL;

    const result = await canBypassSelfApprovalForCloudPilot(
      { actor: actor({ role: "owner" }), organisations: fakeOrganisations([member(ACTOR_ID, "lead", "owner")]) },
      ORG_ID,
    );

    expect(result).toBe(true);
  });
});

describe("requestDraftChanges / rejectDraft — required comments", () => {
  it("requires a comment to send a draft back for changes", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "needs_review" }), viewerRole: "lead", members: [] });
    await expect(requestDraftChanges(deps, { ...request, comment: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires a comment to reject a draft", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "needs_review" }), viewerRole: "lead", members: [] });
    await expect(rejectDraft(deps, { ...request, comment: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a well-formed comment and returns the draft to editable draft status", async () => {
    const { deps, getDraft } = createHarness({
      draft: baseDraft({ status: "needs_review" }),
      viewerRole: "lead",
      members: [],
    });
    await requestDraftChanges(deps, { ...request, comment: "Please tighten the CTA." });
    expect(getDraft().status).toBe("draft");
    expect(getDraft().lastReviewAction).toBe("changes_requested");
  });

  it("approve's comment stays optional", async () => {
    const { deps, getDraft } = createHarness({
      draft: baseDraft({ status: "needs_review", createdBy: profileRef(AUTHOR_ID, "Author") }),
      viewerRole: "lead",
      members: [],
    });
    await approveDraft(deps, { ...request, comment: "" });
    expect(getDraft().status).toBe("approved");
  });
});

describe("returned-for-changes round trip", () => {
  it("lets a draft be resubmitted after changes are requested", async () => {
    const { deps, getDraft } = createHarness({
      draft: baseDraft({ status: "needs_review" }),
      viewerRole: "lead",
      members: [],
    });

    await requestDraftChanges(deps, { ...request, comment: "Needs a stronger hook." });
    expect(getDraft().status).toBe("draft");

    await submitForReview(deps, request);
    expect(getDraft().status).toBe("needs_review");
  });
});

describe("assignReviewer — eligibility and reassignment", () => {
  it("refuses to assign a contributor as reviewer", async () => {
    const { deps } = createHarness({
      draft: baseDraft(),
      viewerRole: "lead",
      members: [member(CONTRIBUTOR_ID, "contributor")],
    });
    await expect(assignReviewer(deps, { ...request, reviewerId: CONTRIBUTOR_ID })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("allows assigning an eligible Reviewer, recorded as 'assigned' the first time", async () => {
    const { deps, getDraft, getHistory } = createHarness({
      draft: baseDraft(),
      viewerRole: "lead",
      members: [member(REVIEWER_ID, "reviewer")],
    });
    await assignReviewer(deps, { ...request, reviewerId: REVIEWER_ID });
    expect(getDraft().assignedReviewer?.id).toBe(REVIEWER_ID);
    expect(getHistory().at(-1)?.action).toBe("assigned");
  });

  it("records a second assignment as 'reassigned', not another 'assigned'", async () => {
    const { deps, getHistory } = createHarness({
      draft: baseDraft({ assignedReviewer: profileRef(REVIEWER_ID, "Reviewer One") }),
      viewerRole: "lead",
      members: [member(REVIEWER_2_ID, "lead")],
    });
    await assignReviewer(deps, { ...request, reviewerId: REVIEWER_2_ID });
    expect(getHistory().at(-1)?.action).toBe("reassigned");
  });

  it("refuses a Reviewer (not a Lead) from assigning anyone", async () => {
    const { deps } = createHarness({
      draft: baseDraft(),
      viewerRole: "reviewer",
      members: [member(REVIEWER_ID, "reviewer")],
    });
    await expect(assignReviewer(deps, { ...request, reviewerId: REVIEWER_ID })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("reopenReview — Lead only, permission boundary", () => {
  it("refuses a Reviewer attempting to reopen an approved draft", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "reviewer", members: [] });
    await expect(reopenReview(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets a Lead reopen an approved draft back into needs_review", async () => {
    const { deps, getDraft } = createHarness({
      draft: baseDraft({ status: "approved" }),
      viewerRole: "lead",
      members: [],
    });
    await reopenReview(deps, request);
    expect(getDraft().status).toBe("needs_review");
  });

  it("lets a Lead reopen a rejected draft back into editable draft", async () => {
    const { deps, getDraft } = createHarness({
      draft: baseDraft({ status: "rejected" }),
      viewerRole: "lead",
      members: [],
    });
    await reopenReview(deps, request);
    expect(getDraft().status).toBe("draft");
  });

  it("refuses to reopen a draft that was never decided", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "draft" }), viewerRole: "lead", members: [] });
    await expect(reopenReview(deps, request)).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reopenReview — failed-publish recovery (fix/failed-publish-recovery, P0)
//
// A publish/schedule attempt that failed for a correctable reason (e.g. the
// Instagram-hashtag-limit rejection from fix/platform-hashtag-policy) left
// the draft locked at "failed" with no transition back to an editable
// state — Genesis instructed the operator to "correct the draft, then
// retry" while the draft itself offered no way to be corrected. Mirrors
// "approved -> needs_review" exactly: same target, same Lead-only
// permission, same "reopened" audit action.
// ─────────────────────────────────────────────────────────────────────────────

describe("reopenReview — failed-publish recovery (mandate 1, 2, 3, 4)", () => {
  it("1: a Lead can reopen a failed draft for correction", async () => {
    const { deps, getDraft } = createHarness({
      draft: baseDraft({ status: "failed" }),
      viewerRole: "lead",
      members: [],
    });
    await reopenReview(deps, request);
    expect(getDraft().status).toBe("needs_review");
  });

  it("2: a non-Lead (Reviewer) cannot reopen a failed draft", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "reviewer", members: [] });
    await expect(reopenReview(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("2b: a Contributor cannot reopen a failed draft either", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor", members: [] });
    await expect(reopenReview(deps, request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("3: the transition is recorded as the same 'reopened' action used for approved/archived recovery — not a new governance mechanism", async () => {
    const { deps, getHistory } = createHarness({
      draft: baseDraft({ status: "failed" }),
      viewerRole: "lead",
      members: [],
    });
    await reopenReview(deps, request);
    const [entry] = getHistory();
    expect(entry?.action).toBe("reopened");
    expect(entry?.previousStatus).toBe("failed");
    expect(entry?.newStatus).toBe("needs_review");
  });

  it("4: needs_review is an editable (unlocked) status — the reopened draft is not still locked", async () => {
    const { isContentDraftLocked } = await import("@/core/domain/entities/content");
    expect(isContentDraftLocked("needs_review")).toBe(false);
  });
});

describe("review history ordering", () => {
  it("returns the most recent action first, unmodified from the repository", async () => {
    const { deps, getHistory } = createHarness({
      draft: baseDraft({ status: "needs_review" }),
      viewerRole: "lead",
      members: [],
    });

    await requestDraftChanges(deps, { ...request, comment: "First pass." });
    await submitForReview(deps, request);
    await approveDraft(deps, { ...request, comment: "" });

    const history = await getReviewHistory(deps, ORG_ID, DRAFT_ID);
    expect(history.map((h) => h.action)).toEqual(["approved", "submitted", "changes_requested"]);
    expect(getHistory().map((h) => h.action)).toEqual(["changes_requested", "submitted", "approved"]);
  });
});
