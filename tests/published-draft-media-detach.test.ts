/**
 * Regression tests for Published Draft Media Detach Lifecycle.
 *
 * Root cause summary:
 *   The detach button on the Draft form is gated by `!locked`. Published drafts
 *   are locked (isContentDraftLocked returns true for "published"), so the button
 *   was unreachable in the UI even though the underlying detachFromDraft repository
 *   method works correctly.
 *
 *   Fix: new `detachAssetFromPublishedDraftAction` server action that:
 *     - requires Lead / platform-admin role (not just contributor)
 *     - verifies the draft exists, belongs to the org, and is in "published" state
 *     - verifies the asset belongs to the org (cross-org protection)
 *     - removes only the content_draft_assets row — draft status, publishing
 *       history, destination, and provider metadata are untouched
 *
 * T1  — Lead on published draft can detach successfully
 * T2  — detachFromDraft called with correct (draftId, assetId)
 * T3  — draft page path revalidated on success
 * T4  — contributor role rejected (only lead / platform-admin allowed)
 * T5  — platform-admin can detach from published draft
 * T6  — reviewer role rejected
 * T7  — requireContext throwing (unauthenticated) surfaces error
 * T8  — draft with status "approved" (not "published") rejected
 * T9  — draft with status "scheduled" rejected
 * T10 — draft belonging to different org (findDraft returns null) rejected
 * T11 — asset belonging to different org (getAsset returns null) rejected
 * T12 — detach does NOT call deleteAsset or deleteMediaFiles
 * T13 — success message mentions social platform unaffected
 * T14 — detachFromDraft throwing returns error, does not crash
 * T15 — findDraft throwing returns error safely
 */

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/routes", () => ({
  routes: {
    organisations: {
      detail: (o: string) => `/organisations/${o}`,
      media: {
        index: (o: string) => `/organisations/${o}/media`,
        detail: (o: string, a: string) => `/organisations/${o}/media/${a}`,
      },
      content: { draft: (o: string, d: string) => `/organisations/${o}/content/${d}` },
      campaigns: { detail: (o: string, c: string) => `/organisations/${o}/campaigns/${c}` },
    },
    login: "/login",
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { detachAssetFromPublishedDraftAction } from "@/server/actions/media";
import { requireContext } from "@/server/container";
import { revalidatePath } from "next/cache";
import type { MediaAsset } from "@/core/domain/entities/media";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { OrganisationRole } from "@/core/domain/entities/identity";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeActor(isPlatformAdmin = false) {
  return { id: "user-1", isActive: true, isPlatformAdmin, role: "member" as const, email: "lead@villiz.com", fullName: "Test Lead", avatarUrl: null, jobTitle: null, createdAt: "2026-01-01T00:00:00Z" };
}

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "asset-1",
    organisationId: "org-1",
    storagePath: "organisations/org-1/1000_photo.jpg",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 204800,
    width: 1920,
    height: 1080,
    uploadedBy: { id: "user-1", fullName: "Test User", email: "test@villiz.com" },
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    title: "Test photo",
    thumbnailPath: null,
    category: "photography",
    description: null,
    altText: null,
    tags: [],
    brand: null,
    duration: null,
    copyrightOwner: null,
    usageRights: null,
    expiresAt: null,
    isAiGenerated: false,
    isArchived: false,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: "draft-1",
    organisationId: "org-1",
    title: "Spring campaign post",
    body: "Draft body",
    status: "published",
    awoStatus: "not_requested",
    contentType: "social_post",
    version: 1,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    summary: null,
    createdBy: { id: "user-1", fullName: "Test User", email: "test@villiz.com" },
    updatedBy: null,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    dueAt: null,
    reviewerIds: [],
    priority: "medium",
    reviewDeadline: null,
    assets: [],
    ...overrides,
  };
}

function baseContext(role: OrganisationRole | null = "lead", isPlatformAdmin = false) {
  return {
    actor: makeActor(isPlatformAdmin),
    organisations: {
      viewerRole: vi.fn(async () => role),
    },
    content: {
      findDraft: vi.fn(async () => makeDraft()),
    },
    media: {
      getAsset: vi.fn(async () => makeAsset()),
      detachFromDraft: vi.fn(async () => {}),
      deleteAsset: vi.fn(async () => {}),
      deleteMediaFiles: vi.fn(async () => {}),
    },
    storage: {
      deleteMediaFiles: vi.fn(async () => {}),
    },
  };
}

function makeContext(overrides: Partial<ReturnType<typeof baseContext>> = {}, role: OrganisationRole | null = "lead", isPlatformAdmin = false) {
  return { ...baseContext(role, isPlatformAdmin), ...overrides };
}

const requireContextMock = vi.mocked(requireContext);
const revalidatePathMock = vi.mocked(revalidatePath);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── T1: Lead on published draft can detach successfully ──────────────────────

describe("T1 — Lead on published draft can detach successfully", () => {
  it("returns success", async () => {
    requireContextMock.mockResolvedValue(makeContext() as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("success");
  });
});

// ─── T2: detachFromDraft called with correct args ─────────────────────────────

describe("T2 — detachFromDraft called with correct (draftId, assetId)", () => {
  it("passes draft id and asset id to the repository", async () => {
    const ctx = makeContext();
    requireContextMock.mockResolvedValue(ctx as never);
    await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(ctx.media.detachFromDraft).toHaveBeenCalledWith("draft-1", "asset-1");
  });
});

// ─── T3: draft page revalidated on success ────────────────────────────────────

describe("T3 — draft page path revalidated on success", () => {
  it("calls revalidatePath with the draft page route", async () => {
    requireContextMock.mockResolvedValue(makeContext() as never);
    await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(revalidatePathMock).toHaveBeenCalledWith(expect.stringContaining("/content/draft-1"));
  });
});

// ─── T4: contributor role rejected ───────────────────────────────────────────

describe("T4 — contributor role is rejected", () => {
  it("returns error and does not call detachFromDraft", async () => {
    const ctx = makeContext({}, "contributor");
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/lead or administrator/i);
    expect(ctx.media.detachFromDraft).not.toHaveBeenCalled();
  });
});

// ─── T5: platform-admin can detach ───────────────────────────────────────────

describe("T5 — platform-admin (no org role) can detach from published draft", () => {
  it("returns success even with null org role when actor is platform admin", async () => {
    const ctx = makeContext({}, null, true);
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("success");
    expect(ctx.media.detachFromDraft).toHaveBeenCalled();
  });
});

// ─── T6: reviewer role rejected ──────────────────────────────────────────────

describe("T6 — reviewer role is rejected", () => {
  it("returns error without calling detachFromDraft", async () => {
    const ctx = makeContext({}, "reviewer");
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("error");
    expect(ctx.media.detachFromDraft).not.toHaveBeenCalled();
  });
});

// ─── T7: requireContext throws (unauthenticated) ──────────────────────────────

describe("T7 — unauthenticated caller (requireContext throws) surfaces error", () => {
  it("returns error status without crashing", async () => {
    requireContextMock.mockRejectedValue(new Error("Not authenticated"));
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("error");
  });
});

// ─── T8: draft status "approved" is rejected ─────────────────────────────────

describe("T8 — draft with status 'approved' is rejected", () => {
  it("returns error and does not call detachFromDraft", async () => {
    const ctx = makeContext({
      content: { findDraft: vi.fn(async () => makeDraft({ status: "approved" })) },
    });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/only available for published drafts/i);
    expect(ctx.media.detachFromDraft).not.toHaveBeenCalled();
  });
});

// ─── T9: draft status "scheduled" is rejected ────────────────────────────────

describe("T9 — draft with status 'scheduled' is rejected", () => {
  it("returns error and does not call detachFromDraft", async () => {
    const ctx = makeContext({
      content: { findDraft: vi.fn(async () => makeDraft({ status: "scheduled" })) },
    });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/only available for published drafts/i);
    expect(ctx.media.detachFromDraft).not.toHaveBeenCalled();
  });
});

// ─── T10: draft belongs to different org (findDraft returns null) ─────────────

describe("T10 — draft belonging to a different org is rejected", () => {
  it("returns not-found error without detaching", async () => {
    const ctx = makeContext({
      content: { findDraft: vi.fn(async (): Promise<null> => null) as never },
    });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-attacker", "draft-1", "asset-1");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/not found or does not belong/i);
    expect(ctx.media.detachFromDraft).not.toHaveBeenCalled();
  });
});

// ─── T11: asset belongs to different org (getAsset returns null) ──────────────

describe("T11 — asset belonging to different org is rejected", () => {
  it("returns not-found error without detaching", async () => {
    const ctx = makeContext({
      media: {
        getAsset: vi.fn(async (): Promise<null> => null) as never,
        detachFromDraft: vi.fn(async () => {}),
        deleteAsset: vi.fn(async () => {}),
        deleteMediaFiles: vi.fn(async () => {}),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-other-org");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/not found or does not belong/i);
    expect(ctx.media.detachFromDraft).not.toHaveBeenCalled();
  });
});

// ─── T12: no permanent delete side-effects ───────────────────────────────────

describe("T12 — detach does not call deleteAsset or deleteMediaFiles", () => {
  it("only calls detachFromDraft, never any destructive storage operations", async () => {
    const ctx = makeContext();
    requireContextMock.mockResolvedValue(ctx as never);
    await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(ctx.media.detachFromDraft).toHaveBeenCalledOnce();
    expect(ctx.media.deleteAsset).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });
});

// ─── T13: success message mentions social platform unaffected ─────────────────

describe("T13 — success message mentions the social platform is not affected", () => {
  it("includes 'social platform' in the success message", async () => {
    requireContextMock.mockResolvedValue(makeContext() as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("success");
    expect(result.message).toMatch(/social platform/i);
  });
});

// ─── T14: detachFromDraft throws → error returned safely ─────────────────────

describe("T14 — detachFromDraft throwing returns error without crashing", () => {
  it("surfaces the error and does not crash", async () => {
    const ctx = makeContext({
      media: {
        getAsset: vi.fn(async () => makeAsset()),
        detachFromDraft: vi.fn(async () => {
          throw new Error("DB write failed");
        }),
        deleteAsset: vi.fn(async () => {}),
        deleteMediaFiles: vi.fn(async () => {}),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("error");
  });
});

// ─── T15: findDraft throwing returns error safely ─────────────────────────────

describe("T15 — findDraft throwing returns error without crashing", () => {
  it("returns error status when the content repository throws", async () => {
    const ctx = makeContext({
      content: {
        findDraft: vi.fn(async () => {
          throw new Error("DB connection lost");
        }),
      },
    });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await detachAssetFromPublishedDraftAction("org-1", "draft-1", "asset-1");
    expect(result.status).toBe("error");
    expect(ctx.media.detachFromDraft).not.toHaveBeenCalled();
  });
});
