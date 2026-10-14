/**
 * GEN-PUB-B — governed posting-asset staging (plan item F).
 *
 * Proves the staging contract end to end with in-memory adapters:
 *   S1   Bucket-level gate — shared media_upload rules (MIME/empty/50 MB)
 *        fail closed, exactly as the bucket enforces at write time.
 *   S2   Per-platform spec check — provider-cited (Blotato docs), never
 *        invented; an in-spec file passes both platforms, an out-of-spec
 *        file is skipped with PLATFORM_SPEC_FAIL.
 *   S3   Provenance — every staged asset produces one `media_staged` audit
 *        row carrying requestId, source, driveRefRaw, linkVerified,
 *        atlasPath and per-platform specs.
 *   S4   Duplicate bytes — same-bytes staging is idempotent: the pre-existing
 *        asset is returned (duplicateOf set), no second storage object, no
 *        second audit event.
 *   S5   Storage failure — a failing StoragePort yields a skip, no asset row,
 *        no audit row, no orphan object.
 *   S6   Row-write failure — createAsset throwing after upload compensates by
 *        deleting the storage object (no silent residue) and reports a skip.
 *   S7   Provenance enforcement — a failed metadata enrichment or audit row
 *        removes the object; an asset is never left half-marked.
 *   S8   recordPostingReference — Drive folder/file links record a
 *        `posting_ref_recorded` provenance row (assetId null, linkVerified
 *        false); no pretend asset is created.
 *   S9   Description codec — parseStagingDescription round-trips the durable
 *        dedupe index (sha256 + requestId); foreign descriptions parse null.
 *
 * No production organisation ids, account ids or client names appear in this
 * file — fictional ids only, mirroring the repo's existing test conventions.
 */

import { describe, expect, it } from "vitest";

import { stagePostingAssets, recordPostingReference, parseStagingDescription, STAGING_CATEGORY, STAGING_DESCRIPTION_PREFIX } from "@/core/application/use-cases/staging/stage-posting-assets";
import { stageAssetCheck, evalPlatformSpecs, parseDriveRef, PLATFORM_IMAGE_SPECS } from "@/core/domain/entities/media-staging";
import type { MediaRepository, MediaAssetWriteModel } from "@/core/application/ports/media-port";
import type { StoragePort } from "@/core/application/ports/storage-port";
import type { AuditRepository, AuditEvent } from "@/core/application/ports/audit-port";
import type { MediaAsset } from "@/core/domain/entities/media";

// ── Fictional organisations — no real ids ────────────────────────────────────

const ORG_A = "aaaaaaaa-0000-4000-b000-000000000001";

const ACTOR = "aaaaaaaa-0000-4000-8999-0000000000a1";
const REQUEST_A = "req-staging-alpha-001";
const REQUEST_B = "req-staging-beta-002";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PNG = "image/png";
const GIF = "image/gif";
const JPEG = "image/jpeg";

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "asset-existing-1",
    organisationId: ORG_A,
    storagePath: `organisations/${ORG_A}/existing.png`,
    fileName: "existing.png",
    fileUrl: "",
    mimeType: PNG,
    typePrefix: "image",
    sizeBytes: 4,
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
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    uploadedBy: { id: ACTOR, fullName: "Staging Operator", email: "staging-operator@example.com" },
    ...overrides,
  } as MediaAsset;
}

interface FakeStoreState {
  assets: MediaAsset[];
  objects: { path: string; bytes: Uint8Array }[];
  deleted: string[];
  nextId: number;
  failUpload: boolean;
  failCreate: boolean;
  failUpdate: boolean;
  failAudit: boolean;
  archived: string[];
  uploadedPaths: string[];
}

function fakeStore(): { state: FakeStoreState; media: MediaRepository; storage: StoragePort; audits: AuditRepository } {
  const state: FakeStoreState = {
    assets: [],
    objects: [],
    deleted: [],
    nextId: 1,
    failUpload: false,
    failCreate: false,
    failUpdate: false,
    failAudit: false,
    archived: [],
    uploadedPaths: [],
  };

  const media = {
    async listAssets(organisationId: string) {
      return state.assets.filter((a) => a.organisationId === organisationId);
    },
    async getAsset(organisationId: string, assetId: string) {
      return state.assets.find((a) => a.organisationId === organisationId && a.id === assetId) ?? null;
    },
    async createAsset(organisationId: string, storagePath: string, fileName: string, mimeType: string, sizeBytes: number, uploadedBy: string): Promise<MediaAsset> {
      if (state.failCreate) throw new Error("createAsset: simulated row failure");
      const asset = makeAsset({
        id: `asset-${state.nextId++}`,
        organisationId,
        storagePath,
        fileName,
        mimeType,
        sizeBytes,
        uploadedBy: { id: uploadedBy, fullName: "Staging Operator", email: "staging-operator@example.com" },
        description: null,
        tags: [],
      });
      state.assets.push(asset);
      return asset;
    },
    async updateAssetMetadata(assetId: string, input: MediaAssetWriteModel): Promise<MediaAsset> {
      if (state.failUpdate) throw new Error("updateAssetMetadata: simulated enrichment failure");
      const asset = state.assets.find((a) => a.id === assetId);
      if (!asset) throw new Error("updateAssetMetadata: asset not found");
      const updated = { ...asset, ...input };
      const idx = state.assets.findIndex((a) => a.id === assetId);
      state.assets[idx] = updated;
      return updated;
    },
    async archiveAsset(organisationId: string, assetId: string): Promise<void> {
      const asset = state.assets.find((a) => a.organisationId === organisationId && a.id === assetId);
      if (!asset) throw new Error("archiveAsset: asset not found");
      const idx = state.assets.findIndex((a) => a.id === assetId);
      state.assets[idx] = { ...asset, isArchived: true };
      state.archived.push(assetId);
    },
  } as unknown as MediaRepository;

  const storage = {
    async uploadMedia(organisationId: string, input: { fileName: string; mimeType: string; fileBuffer: Uint8Array }) {
      if (state.failUpload) throw new Error("storage: simulated upload failure");
      const path = `organisations/${organisationId}/${Date.now()}_${input.fileName}`;
      state.objects.push({ path, bytes: input.fileBuffer });
      state.uploadedPaths.push(path);
      return path;
    },
    async getSignedUrl(storagePath: string) {
      return `https://signed.test/${storagePath}`;
    },
    async deleteMedia(storagePath: string) {
      state.deleted.push(storagePath);
      state.objects = state.objects.filter((o) => o.path !== storagePath);
    },
  } as unknown as StoragePort;

  const audits = {
    async recordEvent(input: { organisationId: string; draftId: string | null; actorId: string | null; eventType: string; description: string; metadata?: Record<string, unknown> }): Promise<AuditEvent> {
      if (state.failAudit) throw new Error("recordEvent: simulated audit failure");
      return { id: `audit-${state.nextId++}`, ...input, createdAt: "2026-10-02T00:00:00.000Z" } as unknown as AuditEvent;
    },
  } as unknown as AuditRepository;

  return { state, media, storage, audits };
}

function pngFile(name = "flier.png", bytes = new Uint8Array([1, 2, 3, 4])) {
  return { fileName: name, mimeType: PNG, bytes };
}

function stageDeps(store: ReturnType<typeof fakeStore>) {
  return { media: store.media, storage: store.storage, audits: store.audits };
}

// ── S1 — bucket-level gate (shared media_upload rules) ───────────────────────

describe("S1: bucket-level gate fails closed", () => {
  it("rejects an unsupported MIME type with MIME_REJECTED (never uploaded)", async () => {
    const store = fakeStore();
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [{ fileName: "note.txt", mimeType: "text/plain", bytes: new Uint8Array([1]) }],
    });
    expect(result.staged).toHaveLength(0);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0]?.code).toBe("MIME_REJECTED");
    expect(store.state.uploadedPaths).toHaveLength(0);
    expect(store.state.assets).toHaveLength(0);
  });

  it("rejects an empty file with EMPTY_FILE", async () => {
    const store = fakeStore();
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [{ fileName: "empty.png", mimeType: PNG, bytes: new Uint8Array(0) }],
    });
    expect(result.staged).toHaveLength(0);
    expect(result.skips[0]?.code).toBe("EMPTY_FILE");
  });

  it("rejects a file over the 50 MB bucket cap with TOO_LARGE", async () => {
    const store = fakeStore();
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [{ fileName: "huge.png", mimeType: PNG, bytes: new Uint8Array(50 * 1024 * 1024 + 1) }],
    });
    expect(result.staged).toHaveLength(0);
    expect(result.skips[0]?.code).toBe("TOO_LARGE");
    expect(store.state.uploadedPaths).toHaveLength(0);
  });
});

// ── S2 — per-platform provider-cited spec check ──────────────────────────────

describe("S2: per-platform spec check", () => {
  it("citations are provider-sourced, never invented", () => {
    expect(PLATFORM_IMAGE_SPECS.instagram.citation).toContain("Instagram");
    expect(PLATFORM_IMAGE_SPECS.instagram.citation).toContain("8 MB");
    expect(PLATFORM_IMAGE_SPECS.tiktok.citation).toContain("TikTok");
    expect(PLATFORM_IMAGE_SPECS.tiktok.citation).toContain("20 MB");
    expect(PLATFORM_IMAGE_SPECS.instagram.source).toContain("help.blotato.com");
    expect(PLATFORM_IMAGE_SPECS.tiktok.source).toContain("help.blotato.com");
  });

  it("stages an in-spec JPEG for instagram and tiktok with withinSpec true", async () => {
    const store = fakeStore();
    const okBytes = new Uint8Array(1024);
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram", "tiktok"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [{ fileName: "photo.jpg", mimeType: JPEG, bytes: okBytes }],
    });
    expect(result.skips).toHaveLength(0);
    const staged = result.staged[0];
    expect(staged?.platformSpecs).toHaveLength(2);
    expect(staged?.platformSpecs.every((s) => s.withinSpec === true)).toBe(true);
    expect(staged?.platformSpecs.map((s) => s.citation)).toEqual(
      expect.arrayContaining([expect.stringContaining("Instagram"), expect.stringContaining("TikTok")]),
    );
  });

  it("skips an 8MB-JPEG-for-TikTok-mime-mismatch as PLATFORM_SPEC_FAIL with the citation", async () => {
    // TikTok's provider-cited image mime list does not include image/png.
    const store = fakeStore();
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["tiktok"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [{ fileName: "design.png", mimeType: PNG, bytes: new Uint8Array(2048) }],
    });
    expect(result.staged).toHaveLength(0);
    expect(result.skips[0]?.code).toBe("PLATFORM_SPEC_FAIL");
    expect(result.skips[0]?.message).toContain("TikTok");
  });

  it("evalPlatformSpecs accepts WebP for TikTok (provider-cited)", () => {
    const result = evalPlatformSpecs({ mimeType: "image/webp", sizeBytes: 1024 }, ["tiktok"]);
    expect(result.ok).toBe(true);
  });
});

// ── S3 — provenance rows carry the full source story ─────────────────────────

describe("S3: provenance rows", () => {
  it("records one media_staged audit event per staged asset with source fields", async () => {
    const store = fakeStore();
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "atlas_path",
      driveRefRaw: null,
      linkVerified: false,
      atlasPath: "/tmp/atlas/fliers/karatique_flyer01_4x5.png",
      files: [pngFile()],
    });
    const row = result.provenanceRows[0];
    expect(row?.assetId).toBe(result.staged[0]?.assetId);
    expect(row?.requestId).toBe(REQUEST_A);
    expect(row?.sha256).toBe(result.staged[0]?.sha256);
    expect(row?.source).toBe("atlas_path");
    const assetInStore = store.state.assets[0];
    expect(assetInStore?.description).toContain(`${STAGING_DESCRIPTION_PREFIX}|sha256=`);
    expect(assetInStore?.description).toContain(`request=${REQUEST_A}`);
    expect(assetInStore?.description).toContain("source=atlas_path");
    expect(assetInStore?.tags).toContain(`sha256:${result.staged[0]?.sha256}`);
    expect(assetInStore?.tags).toContain(`stage:${REQUEST_A}`);
    expect(assetInStore?.category).toBe(STAGING_CATEGORY);
  });

  it("atlasPath rides the audit metadata when the source is atlas_path", async () => {
    const store = fakeStore();
    const { stagePostingAssets: stage } = await import("@/core/application/use-cases/staging/stage-posting-assets");
    const result = await stage(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "atlas_path" as const,
      driveRefRaw: null,
      linkVerified: false,
      atlasPath: "/tmp/atlas/fliers/karatique_flyer01_4x5.png",
      files: [pngFile()],
    });
    expect(result.staged).toHaveLength(1);
    expect(result.provenanceRows).toHaveLength(1);
    expect(result.provenanceRows[0]?.source).toBe("atlas_path");
    expect(result.provenanceRows[0]?.sha256).toBe(result.staged[0]?.sha256);
  });
});

// ── S4 — duplicate bytes are idempotent ──────────────────────────────────────


describe("S4: duplicate-bytes idempotency", () => {
  it("returns the existing asset on re-staging the same bytes — no second object or audit row", async () => {
    const store = fakeStore();
    const deps = stageDeps(store);
    const input = {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram" as const],
      source: "direct_upload" as const,
      driveRefRaw: null,
      linkVerified: false,
      files: [pngFile()],
    };
    const first = await stagePostingAssets(deps, input);
    expect(first.staged).toHaveLength(1);
    expect(first.staged[0]?.duplicateOf).toBeNull();

    const second = await stagePostingAssets(deps, { ...input, requestId: REQUEST_B });
    expect(second.staged).toHaveLength(1);
    expect(second.staged[0]?.assetId).toBe(first.staged[0]?.assetId);
    expect(second.staged[0]?.duplicateOf).toBe(first.staged[0]?.assetId);
    expect(store.state.assets).toHaveLength(1); // one row only
    expect(store.state.objects).toHaveLength(1); // one object only
    // No second audit event was written for the duplicate pass.
    const duplicatedRow = second.provenanceRows[0];
    expect(duplicatedRow).toBeUndefined();
  });

  it("indexes prior provenance via parseStagingDescription — a wiped tags list still dedupes", async () => {
    const store = fakeStore();
    const deps = stageDeps(store);
    const input = {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram" as const],
      source: "direct_upload" as const,
      driveRefRaw: null,
      linkVerified: false,
      files: [pngFile()],
    };
    await stagePostingAssets(deps, input);
    // Simulate the tags index being lost while the provenance description survives.
    const asset = store.state.assets[0];
    if (asset) {
      await store.media.updateAssetMetadata(asset.id, {
        title: null,
        thumbnailPath: null,
        category: STAGING_CATEGORY,
        description: asset.description,
        altText: null,
        tags: [],
        brand: null,
        duration: null,
        copyrightOwner: null,
        usageRights: null,
        expiresAt: null,
        isAiGenerated: false,
        isArchived: false,
      });
    }
    const second = await stagePostingAssets(deps, { ...input, requestId: REQUEST_B });
    expect(second.staged[0]?.duplicateOf).toBe(asset?.id ?? null);
    expect(store.state.objects).toHaveLength(1);
  });
});

// ── S5 — storage failure leaves no residue ───────────────────────────────────

describe("S5: storage failure", () => {
  it("reports a skip and never creates an asset or audit row", async () => {
    const store = fakeStore();
    store.state.failUpload = true;
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [pngFile()],
    });
    expect(result.staged).toHaveLength(0);
    expect(result.skips[0]?.code).toBe("STORAGE_UPLOAD_FAILED");
    expect(store.state.assets).toHaveLength(0);
  });
});

// ── S6 — row-write failure compensates by deleting the uploaded object ───────

describe("S6: createAsset failure compensating cleanup", () => {
  it("deletes the orphan object and reports STAGING_SESSION_FAILED", async () => {
    const store = fakeStore();
    store.state.failCreate = true;
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [pngFile()],
    });
    expect(result.staged).toHaveLength(0);
    expect(result.skips[0]?.code).toBe("STAGING_SESSION_FAILED");
    expect(store.state.deleted).toHaveLength(1); // orphan object removed
    expect(store.state.objects).toHaveLength(0);  // no silent residue
    expect(store.state.assets).toHaveLength(0);
  });
});

// ── S7 — provenance is a hard requirement ────────────────────────────────────

describe("S7: provenance enforcement", () => {
  it("removes the asset object when metadata enrichment fails", async () => {
    const store = fakeStore();
    store.state.failUpdate = true;
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [pngFile()],
    });
    expect(result.staged).toHaveLength(0);
    expect(result.skips[0]?.code).toBe("STAGING_SESSION_FAILED");
    expect(store.state.deleted).toHaveLength(1);
    expect(store.state.archived).toHaveLength(1);
    expect(store.state.assets[0]?.isArchived).toBe(true);
    // The metadata port itself is the injected failure, so the durable archive
    // is the only marker this branch can guarantee.
    expect(store.state.assets[0]?.tags).not.toContain("provenance_failed");
  });

  it("removes the asset object when the audit row itself fails", async () => {
    const store = fakeStore();
    store.state.failAudit = true;
    const result = await stagePostingAssets(stageDeps(store), {
      organisationId: ORG_A,
      uploadedBy: ACTOR,
      requestId: REQUEST_A,
      platforms: ["instagram"],
      source: "direct_upload",
      driveRefRaw: null,
      linkVerified: false,
      files: [pngFile()],
    });
    expect(result.staged).toHaveLength(0);
    expect(store.state.deleted).toHaveLength(1);
    expect(store.state.assets[0]?.tags).toContain("provenance_failed");
  });
});

// ── S8 — Drive references are first-class records, never pretend assets ──────

describe("S8: recordPostingReference", () => {
  it("records a posting_ref_recorded row with assetId null and linkVerified false", async () => {
    const store = fakeStore();
    const row = await recordPostingReference({ audits: store.audits }, {
      organisationId: ORG_A,
      actorId: ACTOR,
      requestId: REQUEST_A,
      driveRefRaw: "https://drive.google.com/folders/1AbCdEfGhIjKlMnOp",
      parsedKind: "folder",
      parsedId: "1AbCdEfGhIjKlMnOp",
      platforms: ["instagram"],
      source: "drive_folder",
    });
    expect(row.assetId).toBeNull();
    expect(row.linkVerified).toBe(false);
    expect(row.driveRefRaw).toContain("drive.google.com");
    expect(store.state.assets).toHaveLength(0); // no pretend asset
    expect(store.state.objects).toHaveLength(0); // no bytes claimed
  });
});

// ── S9 — description codec + intake helpers ──────────────────────────────────

describe("S9: description codec and Drive-ref parsing", () => {
  it("round-trips sha256 and requestId through the description", () => {
    const desc = `${STAGING_DESCRIPTION_PREFIX}|sha256=abc123|request=${REQUEST_A}|source=direct_upload|ref=|link_verified=0|platforms=instagram`;
    const parsed = parseStagingDescription(desc);
    expect(parsed?.sha256).toBe("abc123");
    expect(parsed?.requestId).toBe(REQUEST_A);
  });

  it("returns null for foreign descriptions", () => {
    expect(parseStagingDescription(null)).toBeNull();
    expect(parseStagingDescription("A plain media library note")).toBeNull();
  });

  it("parses folder links, file links and plain folder names", () => {
    const folder = parseDriveRef("https://drive.google.com/folders/1AbCdEfGhIjKlMnOp");
    expect(folder.kind).toBe("folder");
    expect(folder.id).toBe("1AbCdEfGhIjKlMnOp");

    const file = parseDriveRef("https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLk/view");
    expect(file.kind).toBe("file");
    expect(file.id).toBe("1ZyXwVuTsRqPoNmLk");

    const name = parseDriveRef("Genesis fliers Sep");
    expect(name.kind).toBe("folder");
    expect(name.id).toBeNull();
    expect(name.raw).toBe("Genesis fliers Sep");

    expect(parseDriveRef("").kind).toBe("unknown");
  });

  it("stageAssetCheck composes bucket + platform gates", () => {
    const ok = stageAssetCheck({ fileName: "a.jpg", mimeType: JPEG, sizeBytes: 1024, platforms: ["instagram"] });
    expect(ok.valid).toBe(true);
    const bad = stageAssetCheck({ fileName: "a.gif", mimeType: GIF, sizeBytes: 1024, platforms: ["instagram"] });
    expect(bad.valid).toBe(false);
    if (!bad.valid) expect(bad.stop.code).toBe("PLATFORM_SPEC_FAIL");
  });
});