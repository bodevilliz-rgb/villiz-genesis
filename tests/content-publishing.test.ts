import { describe, expect, it } from "vitest";
import { archiveDraft, duplicateDraft, publishDraft, scheduleDraft } from "@/core/application/use-cases/content";
import { ForbiddenError, ValidationError, NotFoundError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import type { ContentDraft, ContentDraftStatus } from "@/core/domain/entities/content";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";

/**
 * Sprint 5 regression coverage for the publishing pipeline use-cases
 * (publishDraft / scheduleDraft / archiveDraft / duplicateDraft) — these had
 * no test coverage at all before this file. The reported "approval workflow
 * gets stuck" symptom traced to duplicate `next dev` processes racing for
 * port 3001 (see scripts/dev-local.js), not to these use-cases, but they sit
 * on the same status machine the bug report was about, and "only approved,
 * scheduled, or failed content can be published/scheduled" is exactly the
 * kind of invalid-transition guard the mission requires locked down.
 */

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
    createdBy: profileRef(AUTHOR_ID, "Author"),
    updatedBy: profileRef(AUTHOR_ID, "Author"),
    priority: "medium",
    reviewDeadline: null,
    hashtags: [],
    ...overrides,
  };
}

/** Same minimal in-memory harness pattern as tests/review-workflow.test.ts. */
function createHarness(input: { draft: ContentDraft; viewerRole: OrganisationRole | null }) {
  let draft = input.draft;
  const statusHistory: ContentDraftStatus[] = [draft.status];

  const content: Partial<ContentRepository> = {
    async findDraft(_organisationId, draftId) {
      return draftId === draft.id ? draft : null;
    },
    async updateStatus(_organisationId, _draftId, status, updatedBy) {
      draft = { ...draft, status, updatedBy: profileRef(updatedBy, updatedBy) };
      statusHistory.push(status);
      return draft;
    },
    async scheduleDraft(_organisationId, _draftId, scheduleInput) {
      draft = {
        ...draft,
        status: "scheduled",
        scheduledAt: scheduleInput.scheduledAt,
        scheduledPlatform: scheduleInput.platform,
        scheduledTimezone: scheduleInput.timezone,
        updatedBy: profileRef(scheduleInput.updatedBy, scheduleInput.updatedBy),
      };
      statusHistory.push("scheduled");
      return draft;
    },
    async createDraft(createInput) {
      return baseDraft({
        id: "00000000-0000-4000-8000-000000000099",
        title: createInput.title,
        status: "draft",
        createdBy: profileRef(createInput.createdBy, createInput.createdBy),
      });
    },
  };

  const organisations: Partial<OrganisationRepository> = {
    async viewerRole() {
      return input.viewerRole;
    },
  };

  return {
    deps: {
      actor: actor(),
      content: content as ContentRepository,
      membrain: {} as never,
      organisations: organisations as OrganisationRepository,
    },
    getDraft: () => draft,
    getStatusHistory: () => statusHistory,
  };
}

describe("publishDraft — valid source statuses only", () => {
  it("moves an approved draft to publishing", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    await publishDraft(deps, ORG_ID, DRAFT_ID);
    expect(getDraft().status).toBe("publishing");
  });

  it("moves a scheduled draft to publishing", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "scheduled" }), viewerRole: "contributor" });
    await publishDraft(deps, ORG_ID, DRAFT_ID);
    expect(getDraft().status).toBe("publishing");
  });

  it("allows retrying a previously failed publish", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "failed" }), viewerRole: "contributor" });
    await publishDraft(deps, ORG_ID, DRAFT_ID);
    expect(getDraft().status).toBe("publishing");
  });

  it("refuses to publish a draft still in review — the exact invalid transition the bug report was about", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "in_review" }), viewerRole: "contributor" });
    await expect(publishDraft(deps, ORG_ID, DRAFT_ID)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to publish a plain unreviewed draft", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "draft" }), viewerRole: "contributor" });
    await expect(publishDraft(deps, ORG_ID, DRAFT_ID)).rejects.toBeInstanceOf(ValidationError);
  });

  it("never silently returns published content to draft — publishing a published draft is refused, not reset", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "published" }), viewerRole: "contributor" });
    await expect(publishDraft(deps, ORG_ID, DRAFT_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(getDraft().status).toBe("published");
  });

  it("refuses a viewer with no write role on the account", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: null });
    await expect(publishDraft(deps, ORG_ID, DRAFT_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("raises NotFoundError for a draft id that does not exist", async () => {
    const { deps } = createHarness({ draft: baseDraft(), viewerRole: "contributor" });
    await expect(publishDraft(deps, ORG_ID, "00000000-0000-4000-8000-000000000404")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("scheduleDraft — valid source statuses only", () => {
  const scheduleInput = { scheduledAt: "2026-09-01T10:00:00Z", platform: "linkedin", timezone: "UTC" };

  it("schedules an approved draft", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    await scheduleDraft(deps, ORG_ID, DRAFT_ID, scheduleInput);
    expect(getDraft().status).toBe("scheduled");
    expect(getDraft().scheduledPlatform).toBe("linkedin");
  });

  it("allows rescheduling an already-scheduled draft", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "scheduled" }), viewerRole: "contributor" });
    await scheduleDraft(deps, ORG_ID, DRAFT_ID, scheduleInput);
    expect(getDraft().status).toBe("scheduled");
  });

  it("refuses to schedule a draft still in review", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "in_review" }), viewerRole: "contributor" });
    await expect(scheduleDraft(deps, ORG_ID, DRAFT_ID, scheduleInput)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to schedule already-published content", async () => {
    const { deps } = createHarness({ draft: baseDraft({ status: "published" }), viewerRole: "contributor" });
    await expect(scheduleDraft(deps, ORG_ID, DRAFT_ID, scheduleInput)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("archiveDraft / duplicateDraft", () => {
  it("archives a draft regardless of its current status", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    await archiveDraft(deps, ORG_ID, DRAFT_ID);
    expect(getDraft().status).toBe("archived");
  });

  it("duplicates an approved draft into a brand-new editable draft, not a mutation of the original", async () => {
    const { deps, getDraft } = createHarness({ draft: baseDraft({ status: "approved" }), viewerRole: "contributor" });
    const copy = await duplicateDraft(deps, ORG_ID, DRAFT_ID);
    expect(copy.id).not.toBe(DRAFT_ID);
    expect(copy.status).toBe("draft");
    expect(copy.title).toContain("(Copy)");
    // The original is untouched — duplicating never mutates the source draft.
    expect(getDraft().status).toBe("approved");
  });
});
