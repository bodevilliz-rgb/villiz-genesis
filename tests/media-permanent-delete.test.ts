/** Media Safe Delete v1 — action, authority, cleanup and idempotency tests. */

const cleanupMocks = vi.hoisted(() => ({ recordCleanupResult: vi.fn(async () => {}) }));
vi.mock("@/server/container", () => ({ requireContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/supabase/admin-client", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/infrastructure/repositories/supabase-media-repository", () => ({
  SupabaseMediaRepository: vi.fn(function () { return { recordCleanupResult: cleanupMocks.recordCleanupResult }; }),
}));
vi.mock("@/lib/routes", () => ({
  routes: {
    organisations: {
      detail: (o: string) => `/organisations/${o}`,
      media: { index: (o: string) => `/organisations/${o}/media`, detail: (o: string, a: string) => `/organisations/${o}/media/${a}` },
      content: { draft: (o: string, d: string) => `/organisations/${o}/content/${d}` },
      campaigns: { detail: (o: string, c: string) => `/organisations/${o}/campaigns/${c}` },
    },
    login: "/login",
  },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveMediaAction, deleteMediaAction, retryMediaCleanupAction } from "@/server/actions/media";
import { requireContext } from "@/server/container";
import { revalidatePath } from "next/cache";

const ORG = "00000000-0000-4000-8000-000000000001";
const ASSET = "00000000-0000-4000-8000-000000000002";
const REQUEST = "00000000-0000-4000-8000-000000000003";
const PATHS = [
  `organisations/${ORG}/active.jpg`,
  `organisations/${ORG}/thumbnail.jpg`,
  `organisations/${ORG}/version.jpg`,
];

function context(options: {
  role?: "lead" | "contributor" | "reviewer" | null;
  admin?: boolean;
  deletion?: { outcome: "BLOCKED"; reasons: Array<{ code: "USED_BY_CONTENT"; count: number }> } | { outcome: "ACCEPTED"; requestId: string; cleanupState: "pending" | "complete"; totalBytes: number };
  paths?: string[];
  storageFailure?: boolean;
  requestFailure?: boolean;
} = {}) {
  const media = {
    requestSafeDeletion: options.requestFailure
      ? vi.fn(async () => { throw new Error("DB transaction failed"); })
      : vi.fn(async () => options.deletion ?? ({ outcome: "ACCEPTED", requestId: REQUEST, cleanupState: "pending", totalBytes: 42 * 1024 * 1024 } as const)),
    getDeletionRequest: vi.fn(async () => ({
      requestId: REQUEST, organisationId: ORG, formerAssetId: ASSET,
      objectPaths: options.paths ?? PATHS, cleanupState: "pending" as const, totalBytes: 42 * 1024 * 1024,
    })),
    archiveAsset: vi.fn(async () => {}),
  };
  return {
    actor: { id: "user-1", isActive: true, isPlatformAdmin: options.admin ?? false },
    organisations: { viewerRole: vi.fn(async () => options.role === undefined ? "lead" : options.role) },
    media,
    storage: {
      deleteMediaFiles: options.storageFailure
        ? vi.fn(async () => { throw new Error("Storage unavailable"); })
        : vi.fn(async () => {}),
      deleteMedia: vi.fn(async () => {}),
    },
  };
}

const requireContextMock = vi.mocked(requireContext);

beforeEach(() => vi.clearAllMocks());

describe("authoritative safe deletion action", () => {
  it("deletes only through the transactional request and cleans exact ledger paths", async () => {
    const ctx = context();
    requireContextMock.mockResolvedValue(ctx as never);

    const result = await deleteMediaAction(ORG, ASSET);

    expect(result).toMatchObject({ status: "success", message: "Media deleted permanently. Storage recovered: 42.0 MB." });
    expect(ctx.media.requestSafeDeletion).toHaveBeenCalledWith(ORG, ASSET, expect.any(String));
    expect(ctx.storage.deleteMediaFiles).toHaveBeenCalledWith(PATHS);
    expect(cleanupMocks.recordCleanupResult).toHaveBeenCalledWith(ORG, REQUEST, true, undefined);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/organisations/${ORG}/media`);
  });

  it("does not touch Storage when the authoritative transaction blocks deletion", async () => {
    const ctx = context({ deletion: { outcome: "BLOCKED", reasons: [{ code: "USED_BY_CONTENT", count: 1 }] } });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await deleteMediaAction(ORG, ASSET);
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/currently or historically used/);
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });

  it("allows an organisation lead", async () => {
    const ctx = context({ role: "lead" });
    requireContextMock.mockResolvedValue(ctx as never);
    expect((await deleteMediaAction(ORG, ASSET)).status).toBe("success");
  });

  it("allows a platform administrator without an organisation role", async () => {
    const ctx = context({ role: null, admin: true });
    requireContextMock.mockResolvedValue(ctx as never);
    expect((await deleteMediaAction(ORG, ASSET)).status).toBe("success");
  });

  it.each(["contributor", "reviewer", null] as const)("denies role %s server-side", async (role) => {
    const ctx = context({ role });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await deleteMediaAction(ORG, ASSET);
    expect(result.status).toBe("error");
    expect(ctx.media.requestSafeDeletion).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });

  it("does not create false cleanup success when the DB transaction fails", async () => {
    const ctx = context({ requestFailure: true });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await deleteMediaAction(ORG, ASSET);
    expect(result.status).toBe("error");
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
    expect(cleanupMocks.recordCleanupResult).not.toHaveBeenCalled();
  });
});

describe("durable Storage cleanup", () => {
  it("reports pending, records the failure, and preserves the request id", async () => {
    const ctx = context({ storageFailure: true });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await deleteMediaAction(ORG, ASSET);
    expect(result).toMatchObject({ status: "success", message: "Media removed from Genesis. Storage cleanup pending.", resourceId: REQUEST });
    expect(cleanupMocks.recordCleanupResult).toHaveBeenCalledWith(ORG, REQUEST, false, "Storage unavailable");
  });

  it("retries the same recorded paths idempotently", async () => {
    const ctx = context();
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await retryMediaCleanupAction(ORG, REQUEST);
    expect(result.message).toBe("Storage cleanup complete.");
    expect(ctx.storage.deleteMediaFiles).toHaveBeenCalledWith(PATHS);
  });

  it("treats already-missing Storage objects as clean when Storage returns no error", async () => {
    const ctx = context(); // Supabase remove is idempotent: absent paths return no error.
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await retryMediaCleanupAction(ORG, REQUEST);
    expect(result.message).toBe("Storage cleanup complete.");
    expect(cleanupMocks.recordCleanupResult).toHaveBeenCalledWith(ORG, REQUEST, true, undefined);
  });

  it("rejects a cross-organisation or arbitrary ledger path before Storage", async () => {
    const ctx = context({ paths: ["organisations/another-org/private.jpg"] });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await retryMediaCleanupAction(ORG, REQUEST);
    expect(result.message).toMatch(/pending/);
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
    expect(cleanupMocks.recordCleanupResult).toHaveBeenCalledWith(ORG, REQUEST, false, expect.stringMatching(/organisation validation/));
  });

  it("does not re-delete Storage for an already-complete duplicate request", async () => {
    const ctx = context({ deletion: { outcome: "ACCEPTED", requestId: REQUEST, cleanupState: "complete", totalBytes: 100 } });
    requireContextMock.mockResolvedValue(ctx as never);
    const result = await deleteMediaAction(ORG, ASSET);
    expect(result.message).toContain("deleted permanently");
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });
});

describe("archive remains non-destructive", () => {
  it("archives without invoking the deletion transaction or Storage", async () => {
    const ctx = context();
    requireContextMock.mockResolvedValue(ctx as never);
    expect((await archiveMediaAction(ORG, ASSET)).status).toBe("success");
    expect(ctx.media.archiveAsset).toHaveBeenCalledWith(ORG, ASSET);
    expect(ctx.media.requestSafeDeletion).not.toHaveBeenCalled();
    expect(ctx.storage.deleteMediaFiles).not.toHaveBeenCalled();
  });
});
