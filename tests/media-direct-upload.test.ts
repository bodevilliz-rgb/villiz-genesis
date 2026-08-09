/**
 * Direct-to-storage media upload transport — fix/direct-media-upload.
 *
 * Root cause (proven in production): uploadMediaAction/replaceMediaVersionAction
 * sent the entire multipart file body through a Vercel serverless function;
 * Vercel rejects request bodies over 4.5 MB with FUNCTION_PAYLOAD_TOO_LARGE at
 * the routing layer, before the action ever runs. The new transport sends the
 * browser only small JSON to the server (ticket issuance + metadata
 * registration) and PUTs file bytes directly into the PRIVATE bucket with a
 * short-lived signed upload token scoped to one server-generated path.
 *
 * T1  — small image: ticket issued for org-scoped path, registration creates asset
 * T2  — 10 MB file (over Vercel's old 4.5 MB ceiling): ticket flow carries only
 *       metadata JSON — no file bytes ever reach a server action
 * T3  — 49 MB file (within the supported 50 MB limit) is accepted
 * T4  — 51 MB file rejected by validateMediaUpload (client fast-fail rule) AND
 *       by the server action before any signed URL is issued
 * T5  — unsupported MIME (audio/mpeg — bucket never allowed audio) rejected
 * T6  — signed upload path is server-generated, organisation-scoped, and sanitised
 * T7  — cross-org forged storagePath (and ../ traversal) rejected at registration
 * T8  — registration creates the media_assets row with exact field values
 * T9  — registration failure returns error status — never a false success
 * T10 — orphaned storage object cleaned up when createAsset fails
 * T11 — replacement uses the same ticket transport + registerMediaReplacementAction
 * T12 — replacement preserves version history via replaceAssetVersion
 * T13 — failed replacement deletes ONLY the new upload; prior asset untouched
 * T14 — successful registration revalidates the Media Library route
 * T15 — Alpha ticket is scoped to Alpha's path; Beta forgeries rejected
 * T16 — forged assetId belonging to another org rejected (getAsset null)
 * T17 — non-member of the organisation cannot obtain a ticket
 *
 * (Duplicate-click prevention is covered in tests/media-upload-zone.test.tsx.)
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
import {
  requestMediaUploadAction,
  registerUploadedMediaAction,
  registerMediaReplacementAction,
} from "@/server/actions/media";
import { requireContext } from "@/server/container";
import { revalidatePath } from "next/cache";
import {
  MEDIA_UPLOAD_MAX_BYTES,
  buildOrganisationStoragePath,
  storagePathBelongsToOrganisation,
  validateMediaUpload,
} from "@/core/domain/entities/media-upload";
import type { MediaAsset } from "@/core/domain/entities/media";

const ALPHA_ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const BETA_ORG_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const MB = 1024 * 1024;

function fakeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "new-asset-1",
    organisationId: ALPHA_ORG_ID,
    storagePath: `organisations/${ALPHA_ORG_ID}/1000_img.jpg`,
    fileName: "img.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100000,
    width: null,
    height: null,
    uploadedBy: null,
    createdAt: "2026-08-09T00:00:00Z",
    updatedAt: "2026-08-09T00:00:00Z",
    title: null,
    thumbnailPath: null,
    category: null,
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

function fakeContext(overrides: {
  isPlatformAdmin?: boolean;
  viewerRole?: string | null;
  createSignedUploadUrl?: ReturnType<typeof vi.fn>;
  deleteMedia?: ReturnType<typeof vi.fn>;
  createAsset?: ReturnType<typeof vi.fn>;
  updateAssetMetadata?: ReturnType<typeof vi.fn>;
  getAsset?: ReturnType<typeof vi.fn>;
  replaceAssetVersion?: ReturnType<typeof vi.fn>;
} = {}) {
  const createSignedUploadUrl =
    overrides.createSignedUploadUrl ??
    vi.fn(async (path: string) => ({ path, token: "signed-upload-token" }));
  const deleteMedia = overrides.deleteMedia ?? vi.fn(async () => undefined);
  const createAsset = overrides.createAsset ?? vi.fn(async () => fakeAsset());
  const updateAssetMetadata = overrides.updateAssetMetadata ?? vi.fn(async () => fakeAsset());
  const getAsset = overrides.getAsset ?? vi.fn(async () => fakeAsset());
  const replaceAssetVersion = overrides.replaceAssetVersion ?? vi.fn(async () => fakeAsset());

  const context = {
    actor: { id: "user-1", isPlatformAdmin: overrides.isPlatformAdmin ?? false },
    organisations: {
      viewerRole: vi.fn(async () => (overrides.viewerRole === undefined ? "contributor" : overrides.viewerRole)),
    },
    storage: { createSignedUploadUrl, deleteMedia },
    media: { createAsset, updateAssetMetadata, getAsset, replaceAssetVersion },
  };

  vi.mocked(requireContext).mockResolvedValue(context as never);
  return { context, createSignedUploadUrl, deleteMedia, createAsset, updateAssetMetadata, getAsset, replaceAssetVersion };
}

function registrationForm(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── T1: happy path ────────────────────────────────────────────────────────────

describe("T1 — small image uploads through the direct-storage path", () => {
  it("issues a ticket for an organisation-scoped path, then registration creates the asset", async () => {
    const { createSignedUploadUrl, createAsset } = fakeContext();

    const ticket = await requestMediaUploadAction(ALPHA_ORG_ID, {
      fileName: "logo.png",
      mimeType: "image/png",
      sizeBytes: 200 * 1024,
    });

    expect(ticket.status).toBe("ready");
    if (ticket.status !== "ready") return;
    expect(ticket.storagePath.startsWith(`organisations/${ALPHA_ORG_ID}/`)).toBe(true);
    expect(ticket.token).toBe("signed-upload-token");
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(1);

    const result = await registerUploadedMediaAction(
      { status: "idle", message: "" },
      registrationForm({
        organisationId: ALPHA_ORG_ID,
        storagePath: ticket.storagePath,
        fileName: "logo.png",
        mimeType: "image/png",
        sizeBytes: String(200 * 1024),
      }),
    );

    expect(result.status).toBe("success");
    expect(createAsset).toHaveBeenCalledWith(ALPHA_ORG_ID, ticket.storagePath, "logo.png", "image/png", 200 * 1024, "user-1");
  });
});

// ── T2–T3: files over Vercel's old ceiling ───────────────────────────────────

describe("T2 — a 10 MB file (over Vercel's 4.5 MB body ceiling) never sends bytes through a server action", () => {
  it("the ticket request carries only { fileName, mimeType, sizeBytes } metadata and succeeds", async () => {
    fakeContext();
    const ticket = await requestMediaUploadAction(ALPHA_ORG_ID, {
      fileName: "big-image.png",
      mimeType: "image/png",
      sizeBytes: 10 * MB,
    });
    // The action signature is metadata-only — there is no parameter through
    // which file bytes could travel; the bytes go browser → storage directly.
    expect(ticket.status).toBe("ready");
  });
});

describe("T3 — a 49 MB file (within the supported 50 MB limit) is accepted", () => {
  it("ticket issued for a large-but-valid file", async () => {
    fakeContext();
    const ticket = await requestMediaUploadAction(ALPHA_ORG_ID, {
      fileName: "video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 49 * MB,
    });
    expect(ticket.status).toBe("ready");
  });
});

// ── T4–T5: rejection rules ────────────────────────────────────────────────────

describe("T4 — over-limit file is rejected on both layers before any signed URL is issued", () => {
  it("validateMediaUpload (the browser's fast-fail rule) rejects 51 MB", () => {
    const result = validateMediaUpload({ mimeType: "image/png", sizeBytes: 51 * MB });
    expect(result.valid).toBe(false);
  });

  it("the server action rejects 51 MB and never calls createSignedUploadUrl", async () => {
    const { createSignedUploadUrl } = fakeContext();
    const ticket = await requestMediaUploadAction(ALPHA_ORG_ID, {
      fileName: "huge.png",
      mimeType: "image/png",
      sizeBytes: 51 * MB,
    });
    expect(ticket.status).toBe("error");
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("MEDIA_UPLOAD_MAX_BYTES is exactly the advertised 50 MB", () => {
    expect(MEDIA_UPLOAD_MAX_BYTES).toBe(50 * MB);
  });
});

describe("T5 — unsupported MIME type is rejected (bucket's own allowed list is the rule)", () => {
  it("audio/mpeg — never accepted by the bucket — is rejected by the shared rule and the action", async () => {
    const { createSignedUploadUrl } = fakeContext();
    expect(validateMediaUpload({ mimeType: "audio/mpeg", sizeBytes: 1024 }).valid).toBe(false);

    const ticket = await requestMediaUploadAction(ALPHA_ORG_ID, {
      fileName: "song.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: 1024,
    });
    expect(ticket.status).toBe("error");
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("registration re-validates MIME server-side even if a ticket was somehow obtained", async () => {
    const { createAsset } = fakeContext();
    const result = await registerUploadedMediaAction(
      { status: "idle", message: "" },
      registrationForm({
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${ALPHA_ORG_ID}/1_song.mp3`,
        fileName: "song.mp3",
        mimeType: "audio/mpeg",
        sizeBytes: "1024",
      }),
    );
    expect(result.status).toBe("error");
    expect(createAsset).not.toHaveBeenCalled();
  });
});

// ── T6–T7: path authority ─────────────────────────────────────────────────────

describe("T6 — the storage path is server-generated, organisation-scoped, and sanitised", () => {
  it("hostile file names cannot traverse or restructure the path", () => {
    const path = buildOrganisationStoragePath(ALPHA_ORG_ID, "../../../etc/passwd", 1000);
    expect(path).toBe(`organisations/${ALPHA_ORG_ID}/1000_.._.._.._etc_passwd`);
    expect(path.includes("/../")).toBe(false);
  });

  it("spaces and commas are sanitised (the exact filename shape that previously produced awkward signed URLs)", () => {
    const path = buildOrganisationStoragePath(ALPHA_ORG_ID, "ChatGPT Image Jul 31, 2026, 08_13_06 PM.png", 1000);
    expect(path.includes(" ")).toBe(false);
    expect(path.includes(",")).toBe(false);
  });

  it("createSignedUploadUrl is called with the server-generated path, not anything browser-supplied", async () => {
    const { createSignedUploadUrl } = fakeContext();
    await requestMediaUploadAction(ALPHA_ORG_ID, { fileName: "a.png", mimeType: "image/png", sizeBytes: 100 });
    const calledPath = createSignedUploadUrl.mock.calls[0]![0] as string;
    expect(calledPath.startsWith(`organisations/${ALPHA_ORG_ID}/`)).toBe(true);
  });
});

describe("T7 — cross-org forged storagePath is rejected at registration", () => {
  it("a Beta-org path presented with an Alpha organisationId is rejected; no asset row created", async () => {
    const { createAsset } = fakeContext();
    const result = await registerUploadedMediaAction(
      { status: "idle", message: "" },
      registrationForm({
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${BETA_ORG_ID}/1_stolen.jpg`,
        fileName: "stolen.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "1000",
      }),
    );
    expect(result.status).toBe("error");
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("path traversal inside an otherwise well-prefixed path is rejected", () => {
    expect(storagePathBelongsToOrganisation(`organisations/${ALPHA_ORG_ID}/../${BETA_ORG_ID}/x.jpg`, ALPHA_ORG_ID)).toBe(false);
  });
});

// ── T8–T10: registration semantics ────────────────────────────────────────────

describe("T8 — registration creates the media_assets row through the existing repository", () => {
  it("createAsset and updateAssetMetadata are both called; metadata mirrors the submitted fields", async () => {
    const { createAsset, updateAssetMetadata } = fakeContext();
    const result = await registerUploadedMediaAction(
      { status: "idle", message: "" },
      registrationForm({
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${ALPHA_ORG_ID}/1_img.jpg`,
        fileName: "img.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "2048",
        title: "My title",
      }),
    );
    expect(result.status).toBe("success");
    expect(createAsset).toHaveBeenCalledTimes(1);
    expect(updateAssetMetadata).toHaveBeenCalledWith("new-asset-1", expect.objectContaining({ title: "My title", isArchived: false }));
  });
});

describe("T9 — registration failure is reported as an error, never a false success", () => {
  it("createAsset throwing yields status:error", async () => {
    fakeContext({ createAsset: vi.fn(async () => { throw new Error("DB write failed"); }) });
    const result = await registerUploadedMediaAction(
      { status: "idle", message: "" },
      registrationForm({
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${ALPHA_ORG_ID}/1_img.jpg`,
        fileName: "img.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "2048",
      }),
    );
    expect(result.status).toBe("error");
  });
});

describe("T10 — orphan cleanup: a failed createAsset removes the already-uploaded storage object", () => {
  it("storage.deleteMedia is called with the exact orphaned path", async () => {
    const deleteMedia = vi.fn(async () => undefined);
    fakeContext({ deleteMedia, createAsset: vi.fn(async () => { throw new Error("DB write failed"); }) });

    await registerUploadedMediaAction(
      { status: "idle", message: "" },
      registrationForm({
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${ALPHA_ORG_ID}/1_orphan.jpg`,
        fileName: "orphan.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "2048",
      }),
    );

    expect(deleteMedia).toHaveBeenCalledWith(`organisations/${ALPHA_ORG_ID}/1_orphan.jpg`);
  });
});

// ── T11–T13: replacement flow ─────────────────────────────────────────────────

describe("T11/T12 — replacement uses the same ticket transport and preserves version history", () => {
  it("registerMediaReplacementAction calls replaceAssetVersion (the existing version-snapshot path)", async () => {
    const { replaceAssetVersion } = fakeContext();
    const result = await registerMediaReplacementAction(
      { status: "idle", message: "" },
      registrationForm({
        assetId: "existing-asset",
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${ALPHA_ORG_ID}/2_replacement.jpg`,
        fileName: "replacement.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "4096",
      }),
    );
    expect(result.status).toBe("success");
    expect(replaceAssetVersion).toHaveBeenCalledWith(
      "existing-asset",
      `organisations/${ALPHA_ORG_ID}/2_replacement.jpg`,
      "replacement.jpg",
      "image/jpeg",
      4096,
      "user-1",
    );
  });
});

describe("T13 — failed replacement deletes only the NEW upload; the current valid asset is untouched", () => {
  it("replaceAssetVersion throwing → deleteMedia(new path) and error status; existing asset's path never deleted", async () => {
    const deleteMedia = vi.fn(async () => undefined);
    const existingAsset = fakeAsset({ id: "existing-asset", storagePath: `organisations/${ALPHA_ORG_ID}/1_current.jpg` });
    fakeContext({
      deleteMedia,
      getAsset: vi.fn(async () => existingAsset),
      replaceAssetVersion: vi.fn(async () => { throw new Error("version insert failed"); }),
    });

    const result = await registerMediaReplacementAction(
      { status: "idle", message: "" },
      registrationForm({
        assetId: "existing-asset",
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${ALPHA_ORG_ID}/2_replacement.jpg`,
        fileName: "replacement.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "4096",
      }),
    );

    expect(result.status).toBe("error");
    expect(deleteMedia).toHaveBeenCalledTimes(1);
    expect(deleteMedia).toHaveBeenCalledWith(`organisations/${ALPHA_ORG_ID}/2_replacement.jpg`);
    expect(deleteMedia).not.toHaveBeenCalledWith(existingAsset.storagePath);
  });
});

// ── T14: refresh ──────────────────────────────────────────────────────────────

describe("T14 — successful registration revalidates the Media Library route", () => {
  it("revalidatePath is called with the org's media index", async () => {
    fakeContext();
    await registerUploadedMediaAction(
      { status: "idle", message: "" },
      registrationForm({
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${ALPHA_ORG_ID}/1_img.jpg`,
        fileName: "img.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "2048",
      }),
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/organisations/${ALPHA_ORG_ID}/media`);
  });
});

// ── T15–T17: organisation isolation ───────────────────────────────────────────

describe("T15 — Alpha and Beta tickets are each scoped to their own organisation's path", () => {
  it("identical code produces organisation-specific paths with no cross-contamination", async () => {
    const { createSignedUploadUrl } = fakeContext();

    const alphaTicket = await requestMediaUploadAction(ALPHA_ORG_ID, { fileName: "a.png", mimeType: "image/png", sizeBytes: 100 });
    const betaTicket = await requestMediaUploadAction(BETA_ORG_ID, { fileName: "b.png", mimeType: "image/png", sizeBytes: 100 });

    expect(alphaTicket.status).toBe("ready");
    expect(betaTicket.status).toBe("ready");
    if (alphaTicket.status !== "ready" || betaTicket.status !== "ready") return;
    expect(alphaTicket.storagePath.startsWith(`organisations/${ALPHA_ORG_ID}/`)).toBe(true);
    expect(betaTicket.storagePath.startsWith(`organisations/${BETA_ORG_ID}/`)).toBe(true);
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(2);
  });
});

describe("T16 — forged assetId belonging to another organisation is rejected on replacement", () => {
  it("getAsset returning null (org-scoped lookup) blocks the replacement", async () => {
    const { replaceAssetVersion } = fakeContext({ getAsset: vi.fn(async () => null) });
    const result = await registerMediaReplacementAction(
      { status: "idle", message: "" },
      registrationForm({
        assetId: "someone-elses-asset",
        organisationId: ALPHA_ORG_ID,
        storagePath: `organisations/${ALPHA_ORG_ID}/2_x.jpg`,
        fileName: "x.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "100",
      }),
    );
    expect(result.status).toBe("error");
    expect(replaceAssetVersion).not.toHaveBeenCalled();
  });
});

describe("T17 — a non-member of the organisation cannot obtain an upload ticket", () => {
  it("viewerRole null → error, no signed URL issued", async () => {
    const { createSignedUploadUrl } = fakeContext({ viewerRole: null });
    const ticket = await requestMediaUploadAction(ALPHA_ORG_ID, { fileName: "a.png", mimeType: "image/png", sizeBytes: 100 });
    expect(ticket.status).toBe("error");
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
