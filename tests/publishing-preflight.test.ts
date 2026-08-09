/**
 * Platform Publishing Preflight — 17 required tests.
 *
 * Covers:
 *   T1–T8   evaluatePlatformPreflight — pure domain function, no IO
 *   T9–T12  checkPublishingPreflight — async use case with mock repositories
 *   T13–T14 Server action enforcement — live vs simulation mode
 *   T15–T16 Worker fail-closed — live vs simulation path via pollOnce
 *   T17     Combined scenario — multiple blockers listed together
 */

// ── Module-scope mocks required for server action tests (T13–T14) ─────────────
// vi.mock() is hoisted; these mock the infrastructure that server actions import.

vi.mock("@/infrastructure/blotato/blotato-config", () => ({
  blotatoConfig: vi.fn(),
}));

vi.mock("@/server/container", () => ({
  requireContext: vi.fn(),
}));

// Only needed by the new T26 success-path test — no prior test in this file
// reached a successful createImmediatePublishingJobAction, which is the
// first path that calls revalidatePublishing() -> revalidatePath().
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publishing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/application/use-cases/publishing")>();
  return {
    ...actual,
    createImmediatePublishingJob: vi.fn(async () => ({ id: "job-created" })),
    createScheduledPublishingJob: vi.fn(async () => ({ id: "job-scheduled" })),
  };
});

// Worker infra mocks — keep buildDeps from creating real Supabase clients (T15–T16)
vi.mock("@/infrastructure/supabase/admin-client", () => ({
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-publishing-repository", () => ({
  SupabasePublishingRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-content-repository", () => ({
  SupabaseContentRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-audit-repository", () => ({
  SupabaseAuditRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-notification-repository", () => ({
  SupabaseNotificationRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-blotato-account-repository", () => ({
  SupabaseBlotatoAccountRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/repositories/supabase-media-repository", () => ({
  SupabaseMediaRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/ports/supabase-storage-port", () => ({
  SupabaseStoragePort: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/blotato/http-blotato-client", () => ({
  HttpBlotatoClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/infrastructure/publishers/publisher-factory", () => ({
  resolvePublisher: vi.fn(),
}));
vi.mock("@/infrastructure/publishers/simulation-mode", () => ({
  resolveEffectiveSimulationMode: vi.fn(() => null),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluatePlatformPreflight } from "@/core/domain/entities/publishing-preflight";
import { checkPublishingPreflight } from "@/core/application/use-cases/publishing/preflight";
import { pollOnce } from "../scripts/publishing-worker-core";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { requireContext } from "@/server/container";
import {
  createImmediatePublishingJobAction,
  createScheduledPublishingJobAction,
} from "@/server/actions/publishing";
import type { MediaAsset } from "@/core/domain/entities/media";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "asset-1",
    organisationId: "org-1",
    storagePath: "org-1/image.jpg",
    fileName: "image.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 50000,
    width: null,
    height: null,
    isArchived: false,
    isAiGenerated: false,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    uploadedBy: { id: "user-1", fullName: "Test User", email: "test@villiz.com" },
    title: null,
    thumbnailPath: null,
    category: null,
    description: null,
    altText: null,
    brand: null,
    duration: null,
    copyrightOwner: null,
    usageRights: null,
    expiresAt: null,
    ...overrides,
  };
}

/** Build a minimal mock deps object for pollOnce / processJob tests. */
function makePollDeps(overrides: Record<string, unknown> = {}) {
  const attempt = { id: "attempt-1", attemptNumber: 1 };
  const job = {
    id: "job-1",
    organisationId: "org-1",
    draftId: "draft-1",
    platform: "instagram" as const,
    triggerType: "immediate" as const,
    scheduledFor: new Date().toISOString(),
    status: "queued" as const,
    idempotencyKey: "idem-1",
    requestedBy: "user-1",
    requestedByProfile: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    claimedBy: null,
    nextAttemptAt: null,
    retryCount: 0,
    maxRetries: 3,
    completedAt: null,
    cancelledAt: null,
    devSimulationMode: null,
    resolvedAccountId: null,
  };

  const failAttempt = vi.fn(async () => {});
  const markJobFailed = vi.fn(async () => {});

  return {
    deps: {
      publishing: {
        // Return the job once, then null so pollOnce's for(;;) exits cleanly.
        claimNextJob: vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null),
        listAttemptsForJob: vi.fn(async () => []),
        createAttempt: vi.fn(async () => attempt),
        startAttempt: vi.fn(async () => ({ ...attempt })),
        completeAttempt: vi.fn(async () => {}),
        failAttempt,
        markJobPublished: vi.fn(async () => {}),
        markJobFailed,
      },
      content: {
        findDraft: vi.fn(async () => ({
          id: "draft-1",
          organisationId: "org-1",
          title: "Test Post",
          body: "Body text here",
          status: "approved",
        })),
        updateStatus: vi.fn(async () => ({})),
      },
      audits: { recordEvent: vi.fn(async () => {}) },
      notifications: { createNotification: vi.fn(async () => {}) },
      blotatoAccounts: {
        findActiveForOrganisationAndPlatform: vi.fn(async () => [{ id: "acc-1" }]),
      },
      blotatoClient: {},
      blotatoLivePublishingEnabled: false,
      media: {
        listAssetsForDraft: vi.fn(async () => []),
      },
      storage: { getSignedUrl: vi.fn(async () => "https://cdn.example.com/image.jpg") },
      ...overrides,
    },
    failAttempt,
    markJobFailed,
  };
}

// ── T1–T8: evaluatePlatformPreflight — pure domain function ─────────────────

describe("T1 — Instagram live mode: missing media → blocked", () => {
  it("returns ready:false with Instagram media blocker", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption text", 0);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Instagram requires at least one image or video.");
  });
});

describe("T2 — Instagram simulation: missing media → simulationAllowed:true", () => {
  it("simulationAllowed is always true even when ready is false", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption text", 0);
    expect(result.ready).toBe(false);
    expect(result.simulationAllowed).toBe(true);
  });
});

describe("T3 — Valid Instagram: body + media → ready:true", () => {
  it("returns ready:true when body and media are both present", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption text", 2);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

describe("T4 — Facebook text-only live: no media → ready:true", () => {
  it("Facebook does not require media — text-only posts are accepted", () => {
    const result = evaluatePlatformPreflight("facebook", "A text-only post", 0);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

describe("T5 — LinkedIn text-only live: no media → ready:true", () => {
  it("LinkedIn does not require media", () => {
    const result = evaluatePlatformPreflight("linkedin", "Professional update", 0);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

describe("T6 — X text-only live: no media → ready:true", () => {
  it("X does not require media", () => {
    const result = evaluatePlatformPreflight("x", "Short post", 0);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

describe("T7 — Empty body: blocked across all platforms", () => {
  it.each(["instagram", "facebook", "linkedin", "x"] as const)(
    "%s with empty body → blocked",
    (platform) => {
      const result = evaluatePlatformPreflight(platform, "   ", 1);
      expect(result.ready).toBe(false);
      expect(result.blockers).toContain("Post body cannot be empty.");
    },
  );
});

describe("T8 — AI score does NOT determine preflight readiness", () => {
  it("evaluatePlatformPreflight has no aiScore parameter — score is irrelevant", () => {
    // The function signature accepts only (platform, body, publishableMediaCount).
    // There is no aiScore parameter, so a score of 100 cannot make preflight pass
    // when platform requirements are not met.
    const result = evaluatePlatformPreflight("instagram", "Great caption!", 0);
    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.includes("image or video"))).toBe(true);
  });
});

// ── T9–T12: checkPublishingPreflight — use case with mock repositories ────────

describe("T9 — checkPublishingPreflight: Instagram + no assets → blocked", () => {
  it("blocks when the draft has no linked assets for Instagram", async () => {
    const mockContent = { findDraft: vi.fn(async () => ({ body: "Caption", id: "d-1" })) };
    const mockMedia = { listAssetsForDraft: vi.fn(async () => []) };

    const result = await checkPublishingPreflight(
      { content: mockContent as never, media: mockMedia as never },
      { organisationId: "org-1", draftId: "d-1", platform: "instagram" },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Instagram requires at least one image or video.");
  });
});

describe("T10 — checkPublishingPreflight: Instagram + image asset → ready", () => {
  it("passes when the draft has at least one publishable image", async () => {
    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    const mockContent = { findDraft: vi.fn(async () => ({ body: "Caption", id: "d-1" })) };
    const mockMedia = { listAssetsForDraft: vi.fn(async () => [asset]) };

    const result = await checkPublishingPreflight(
      { content: mockContent as never, media: mockMedia as never },
      { organisationId: "org-1", draftId: "d-1", platform: "instagram" },
    );

    expect(result.ready).toBe(true);
  });
});

describe("T11 — Org isolation: cross-org asset not counted", () => {
  it("an asset owned by another organisation is excluded from the publishable count", async () => {
    const crossOrgAsset = makeAsset({ organisationId: "org-other", mimeType: "image/jpeg" });
    const mockContent = { findDraft: vi.fn(async () => ({ body: "Caption", id: "d-1" })) };
    const mockMedia = { listAssetsForDraft: vi.fn(async () => [crossOrgAsset]) };

    const result = await checkPublishingPreflight(
      { content: mockContent as never, media: mockMedia as never },
      { organisationId: "org-1", draftId: "d-1", platform: "instagram" },
    );

    // Cross-org asset must not count — Instagram still sees 0 publishable media
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Instagram requires at least one image or video.");
  });
});

describe("T12 — Non-image/video asset (e.g. PDF) not counted as publishable", () => {
  it("application/pdf assets are filtered out and do not satisfy the media requirement", async () => {
    const pdfAsset = makeAsset({ organisationId: "org-1", mimeType: "application/pdf" });
    const mockContent = { findDraft: vi.fn(async () => ({ body: "Caption", id: "d-1" })) };
    const mockMedia = { listAssetsForDraft: vi.fn(async () => [pdfAsset]) };

    const result = await checkPublishingPreflight(
      { content: mockContent as never, media: mockMedia as never },
      { organisationId: "org-1", draftId: "d-1", platform: "instagram" },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Instagram requires at least one image or video.");
  });
});

// ── T13–T14: Server action enforcement ────────────────────────────────────────

const blotatoConfigMock = vi.mocked(blotatoConfig);
const requireContextMock = vi.mocked(requireContext);

function makeActionContext(assets: MediaAsset[] = []) {
  return {
    actor: { id: "user-1", isPlatformAdmin: false },
    content: {
      findDraft: vi.fn(async () => ({
        id: "draft-1",
        organisationId: "org-1",
        body: "Some content",
        title: "Test",
        status: "approved",
        assets,
      })),
      updateStatus: vi.fn(async () => ({})),
    },
    media: {
      listAssetsForDraft: vi.fn(async () => assets),
    },
    publishing: {
      findActiveJobForDraftPlatform: vi.fn(async () => null),
      createJob: vi.fn(async () => ({ id: "job-1", status: "queued" })),
    },
    blotatoAccounts: {
      findActiveForOrganisationAndPlatform: vi.fn(async () => [{ id: "acc-1" }]),
    },
    organisations: { viewerRole: vi.fn(async () => "admin") },
    audits: { recordEvent: vi.fn(async () => {}) },
    notifications: { createNotification: vi.fn(async () => {}) },
  };
}

function makePublishFormData(platform = "instagram"): FormData {
  const fd = new FormData();
  fd.append("organisationId", "org-1");
  fd.append("id", "draft-1");
  fd.append("platform", platform);
  fd.append("idempotencyKey", "key-123");
  return fd;
}

describe("T13 — Immediate action: live mode + no media → error returned", () => {
  beforeEach(() => {
    blotatoConfigMock.mockReturnValue({ apiKey: "key", enabled: true, livePublishingEnabled: true });
    requireContextMock.mockResolvedValue(makeActionContext([]) as never);
  });

  it("returns error state with a human-readable message when preflight fails in live mode", async () => {
    const result = await createImmediatePublishingJobAction(
      { status: "idle", message: "" },
      makePublishFormData("instagram"),
    );
    expect(result.status).toBe("error");
    expect(result.message).toContain("Cannot publish");
    expect(result.message).toContain("Instagram");
  });
});

describe("T14 — Scheduled action: live mode + no media → error returned", () => {
  beforeEach(() => {
    blotatoConfigMock.mockReturnValue({ apiKey: "key", enabled: true, livePublishingEnabled: true });
    requireContextMock.mockResolvedValue(makeActionContext([]) as never);
  });

  it("returns error state for Instagram scheduled job in live mode with no media", async () => {
    const fd = makePublishFormData("instagram");
    // scheduledForUtc is the pre-converted UTC instant the browser now sends
    // (see fix/scheduled-publishing-integrity) — the action no longer reads
    // a raw scheduledAt/timezone pair server-side.
    fd.append("scheduledForUtc", new Date(Date.now() + 3_600_000).toISOString());
    fd.append("timezone", "UTC");

    const result = await createScheduledPublishingJobAction(
      { status: "idle", message: "" },
      fd,
    );
    expect(result.status).toBe("error");
    expect(result.message).toContain("Cannot schedule");
  });
});

// ── T15–T16: Worker fail-closed vs simulation pass-through ────────────────────

describe("T15 — Worker live mode: Instagram + no media → attempt fails with preflight_failed", () => {
  it("processJob fails the attempt instead of calling the publisher", async () => {
    const { deps, failAttempt, markJobFailed } = makePollDeps({
      blotatoLivePublishingEnabled: true,
      // media returns empty — no publishable assets
      media: { listAssetsForDraft: vi.fn(async () => []) },
    });

    await pollOnce(deps as never);

    // deps.publishing.failAttempt is called as failAttempt(attemptId, failure)
    expect(failAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({ errorCode: "preflight_failed" }),
    );
    expect(markJobFailed).toHaveBeenCalled();
  });
});

describe("T16 — Worker simulation mode: Instagram + no media → publisher is called (no block)", () => {
  it("processJob proceeds to the publisher even without media when simulation mode is active", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "post-sim-1",
      externalUrl: "https://instagram.com/p/sim-1",
      publishedAt: new Date().toISOString(),
    }));
    const mockPublisher = { publish: publishFn };

    const { resolvePublisher } = await import("@/infrastructure/publishers/publisher-factory");
    vi.mocked(resolvePublisher).mockReturnValue(mockPublisher as never);

    const { deps, failAttempt } = makePollDeps({
      blotatoLivePublishingEnabled: false,
      media: { listAssetsForDraft: vi.fn(async () => []) },
    });

    await pollOnce(deps as never);

    // Simulation: preflight is NOT enforced, publisher IS called
    expect(failAttempt).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ errorCode: "preflight_failed" }),
    );
    expect(publishFn).toHaveBeenCalled();
  });
});

// ── T17 — Combined scenario: multiple blockers ─────────────────────────────────

describe("T17 — Multiple blockers: empty body + Instagram + no media → all blockers listed", () => {
  it("collects all failures into the blockers array rather than stopping at the first", () => {
    const result = evaluatePlatformPreflight("instagram", "", 0);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Post body cannot be empty.");
    expect(result.blockers).toContain("Instagram requires at least one image or video.");
    expect(result.blockers).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T18–T26 — Platform hashtag policy (fix/platform-hashtag-policy, P0)
// A scheduled Instagram job with 6 first-class hashtags passed Pre-Publish
// Review ("Optimal", "requirements met") and reached the worker, which
// submitted the composed caption and got a live Blotato 422 — "Instagram
// allows a maximum of 5 hashtags per post." evaluatePlatformPreflight had no
// hashtag parameter at all. These tests prove the fix at every enforcement
// layer: the pure function, job-creation preflight, and worker execution.
// ─────────────────────────────────────────────────────────────────────────────

describe("T18/T1 (mandate) — Instagram: 5 hashtags passes preflight", () => {
  it("ready:true with media present and exactly 5 hashtags", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption", 1, ["a", "b", "c", "d", "e"]);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

describe("T19/T2 (mandate) — Instagram: 6 hashtags fails deterministic preflight", () => {
  it("ready:false with the exact dynamic-count message", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption", 1, ["a", "b", "c", "d", "e", "f"]);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Instagram allows a maximum of 5 hashtags. Remove 1 hashtag before publishing.");
  });
});

describe("T20/T3 (mandate) — Instagram: more than 6 hashtags also fails", () => {
  it("ready:false for 8 hashtags, with excess count of 3 in the message", () => {
    const result = evaluatePlatformPreflight("instagram", "Caption", 1, ["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Instagram allows a maximum of 5 hashtags. Remove 3 hashtags before publishing.");
  });
});

describe("T21/T15 (mandate) — a non-Instagram platform does not inherit the 5-hashtag limit", () => {
  it("Facebook with 6 hashtags remains ready (no verified limit)", () => {
    const result = evaluatePlatformPreflight("facebook", "Caption", 0, ["a", "b", "c", "d", "e", "f"]);
    expect(result.ready).toBe(true);
  });
});

describe("T22 — checkPublishingPreflight: Instagram + image + 6 hashtags → blocked", () => {
  it("job-creation preflight reads draft.hashtags and blocks", async () => {
    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    const mockContent = {
      findDraft: vi.fn(async () => ({ body: "Caption", id: "d-1", hashtags: ["a", "b", "c", "d", "e", "f"] })),
    };
    const mockMedia = { listAssetsForDraft: vi.fn(async () => [asset]) };

    const result = await checkPublishingPreflight(
      { content: mockContent as never, media: mockMedia as never },
      { organisationId: "org-1", draftId: "d-1", platform: "instagram" },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("Instagram allows a maximum of 5 hashtags. Remove 1 hashtag before publishing.");
  });

  it("T12 (mandate) — the same draft with 5 hashtags is ready", async () => {
    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    const mockContent = {
      findDraft: vi.fn(async () => ({ body: "Caption", id: "d-1", hashtags: ["a", "b", "c", "d", "e"] })),
    };
    const mockMedia = { listAssetsForDraft: vi.fn(async () => [asset]) };

    const result = await checkPublishingPreflight(
      { content: mockContent as never, media: mockMedia as never },
      { organisationId: "org-1", draftId: "d-1", platform: "instagram" },
    );

    expect(result.ready).toBe(true);
  });
});

describe("T23/T10/T11 (mandate) — Worker live mode: Instagram job with 6 hashtags fails BEFORE publishPost", () => {
  it("preflight_failed is recorded and the publisher is never invoked (publishPost call count 0)", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "should-never-be-called",
      externalUrl: "https://instagram.com/p/never",
      publishedAt: new Date().toISOString(),
    }));
    const { resolvePublisher } = await import("@/infrastructure/publishers/publisher-factory");
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    const { deps, failAttempt, markJobFailed } = makePollDeps({
      blotatoLivePublishingEnabled: true,
      content: {
        findDraft: vi.fn(async () => ({
          id: "draft-1",
          organisationId: "org-1",
          title: "Birthday post",
          body: "Body text here",
          status: "approved",
          hashtags: ["coventryphotographer", "coventryuniversity", "photoshoot", "birthdaycelebration", "westmidlands", "milestonecelebration"],
        })),
        updateStatus: vi.fn(async () => ({})),
      },
      media: { listAssetsForDraft: vi.fn(async () => [asset]) },
    });

    await pollOnce(deps as never);

    expect(failAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({
        errorCode: "preflight_failed",
        errorMessage: expect.stringContaining("Instagram allows a maximum of 5 hashtags"),
      }),
    );
    expect(markJobFailed).toHaveBeenCalled();
    // The exact production failure mode this prevents: publishPost (here,
    // publisher.publish) must never be reached once preflight has failed.
    expect(publishFn).not.toHaveBeenCalled();
  });
});

describe("T24/T12/T13 (mandate) — Worker live mode: Instagram job with 5 hashtags proceeds to the publisher", () => {
  it("no preflight_failed is recorded and the publisher is invoked", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "post-1",
      externalUrl: "https://instagram.com/p/real",
      publishedAt: new Date().toISOString(),
    }));
    const { resolvePublisher } = await import("@/infrastructure/publishers/publisher-factory");
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    const { deps, failAttempt } = makePollDeps({
      blotatoLivePublishingEnabled: true,
      content: {
        findDraft: vi.fn(async () => ({
          id: "draft-1",
          organisationId: "org-1",
          title: "Birthday post",
          body: "Body text here",
          status: "approved",
          hashtags: ["a", "b", "c", "d", "e"],
        })),
        updateStatus: vi.fn(async () => ({})),
      },
      media: { listAssetsForDraft: vi.fn(async () => [asset]) },
    });

    await pollOnce(deps as never);

    expect(failAttempt).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "preflight_failed" }),
    );
    expect(publishFn).toHaveBeenCalledTimes(1);
  });
});

describe("T25/T17 (mandate) — Worker simulation mode: 6 hashtags does NOT block; simulation never calls the provider anyway", () => {
  it("preflight is not enforced in simulation, and the publisher used is the simulation path (no real provider call, matching existing simulation semantics)", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "sim-1",
      externalUrl: "https://mock.local/instagram/sim-1",
      publishedAt: new Date().toISOString(),
    }));
    const { resolvePublisher } = await import("@/infrastructure/publishers/publisher-factory");
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const { deps, failAttempt } = makePollDeps({
      blotatoLivePublishingEnabled: false,
      content: {
        findDraft: vi.fn(async () => ({
          id: "draft-1",
          organisationId: "org-1",
          title: "Birthday post",
          body: "Body text here",
          status: "approved",
          hashtags: ["a", "b", "c", "d", "e", "f"],
        })),
        updateStatus: vi.fn(async () => ({})),
      },
      media: { listAssetsForDraft: vi.fn(async () => []) },
    });

    await pollOnce(deps as never);

    expect(failAttempt).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "preflight_failed" }),
    );
    expect(publishFn).toHaveBeenCalled();
  });
});

describe("T26 — Immediate job creation (server action): 6 hashtags blocked, 5 proceeds", () => {
  beforeEach(() => {
    blotatoConfigMock.mockReturnValue({ apiKey: "key", enabled: true, livePublishingEnabled: true });
  });

  it("live mode rejects job creation with the hashtag-limit message when the draft has 6 hashtags", async () => {
    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    // Build a context whose findDraft includes 6 hashtags.
    const ctx = makeActionContext([asset]);
    ctx.content.findDraft = vi.fn(async () => ({
      id: "draft-1",
      organisationId: "org-1",
      body: "Some content",
      title: "Test",
      status: "approved",
      assets: [asset],
      hashtags: ["a", "b", "c", "d", "e", "f"],
    })) as never;
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, makePublishFormData("instagram"));

    expect(result.status).toBe("error");
  });

  it("live mode allows job creation when the draft has exactly 5 hashtags", async () => {
    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    const ctx = makeActionContext([asset]);
    ctx.content.findDraft = vi.fn(async () => ({
      id: "draft-1",
      organisationId: "org-1",
      body: "Some content",
      title: "Test",
      status: "approved",
      assets: [asset],
      hashtags: ["a", "b", "c", "d", "e"],
    })) as never;
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await createImmediatePublishingJobAction({ status: "idle", message: "" }, makePublishFormData("instagram"));

    expect(result.status).toBe("success");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T27–T28 (fix/failed-publish-recovery, mandate 16/17/18/19) — a retried job
// (requeued via retryFailedPublishingJob after reopen-for-correction and
// reapproval) is claimed by the exact same worker path as a first attempt —
// processJob always fetches the CURRENT draft fresh, never a snapshot from
// the original failed attempt. Proves the 6-hashtag production failure,
// once corrected to 5, reaches the provider payload as exactly 5.
// ─────────────────────────────────────────────────────────────────────────────

describe("T27/T16/T17/T18/T19 (mandate) — a corrected draft's latest body/hashtags/media reach the retried provider call", () => {
  it("6 hashtags originally failed; after correction to 5, the retried claim composes exactly 5 into the publish call", async () => {
    const publishFn = vi.fn(async (_args: { body: string }) => ({
      success: true as const,
      externalPostId: "post-retry-1",
      externalUrl: "https://instagram.com/p/retry",
      publishedAt: new Date().toISOString(),
    }));
    const { resolvePublisher } = await import("@/infrastructure/publishers/publisher-factory");
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    const { deps } = makePollDeps({
      blotatoLivePublishingEnabled: true,
      content: {
        // Simulates the state AFTER reopen-for-correction + reapproval: the
        // draft the worker fetches at claim time is the CURRENT, corrected
        // one — not whatever it looked like at the original failed attempt.
        findDraft: vi.fn(async () => ({
          id: "draft-1",
          organisationId: "org-1",
          title: "Birthday post",
          body: "Corrected body text",
          status: "approved",
          hashtags: ["coventryphotographer", "coventryuniversity", "photoshoot", "birthdaycelebration", "westmidlands"],
        })),
        updateStatus: vi.fn(async () => ({})),
      },
      media: { listAssetsForDraft: vi.fn(async () => [asset]) },
    });

    await pollOnce(deps as never);

    expect(publishFn).toHaveBeenCalledTimes(1);
    const publishArgs = publishFn.mock.calls[0]![0];
    const hashtagCount = (publishArgs.body.match(/#\w+/g) ?? []).length;
    expect(hashtagCount).toBe(5);
    expect(publishArgs.body).toContain("Corrected body text");
  });
});

describe("T28 (mandate 20/21) — deterministic preflight still runs on retry; an invalid corrected draft remains blocked", () => {
  it("a 'corrected' draft that still has 6 hashtags is blocked again, exactly as the original attempt was", async () => {
    const publishFn = vi.fn(async () => ({
      success: true as const,
      externalPostId: "should-not-happen",
      externalUrl: "https://instagram.com/p/never",
      publishedAt: new Date().toISOString(),
    }));
    const { resolvePublisher } = await import("@/infrastructure/publishers/publisher-factory");
    vi.mocked(resolvePublisher).mockReturnValue({ publish: publishFn } as never);

    const asset = makeAsset({ organisationId: "org-1", mimeType: "image/jpeg" });
    const { deps, failAttempt } = makePollDeps({
      blotatoLivePublishingEnabled: true,
      content: {
        findDraft: vi.fn(async () => ({
          id: "draft-1",
          organisationId: "org-1",
          title: "Birthday post",
          body: "Still has too many tags",
          status: "approved",
          hashtags: ["a", "b", "c", "d", "e", "f"], // still 6 — an inadequate "correction"
        })),
        updateStatus: vi.fn(async () => ({})),
      },
      media: { listAssetsForDraft: vi.fn(async () => [asset]) },
    });

    await pollOnce(deps as never);

    expect(failAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({ errorCode: "preflight_failed" }),
    );
    expect(publishFn).not.toHaveBeenCalled();
  });
});
