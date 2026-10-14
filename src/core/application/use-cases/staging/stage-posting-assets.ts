import "server-only";

import { createHash } from "node:crypto";

import type { MediaRepository } from "@/core/application/ports/media-port";
import type { StoragePort } from "@/core/application/ports/storage-port";
import type { AuditRepository } from "@/core/application/ports/audit-port";
import {
  PLATFORM_IMAGE_SPECS,
  stageAssetCheck,
  type PostingPlatform,
  type StagedPostingAsset,
  type StagingSourceKind,
  type StagingStop,
} from "@/core/domain/entities/media-staging";

/**
 * GEN-PUB-B — stage posting assets into the governed Media Library.
 *
 * One staged asset = (1) bucket-level validation (shared with the upload
 * transport), (2) per-platform provider-cited spec check, (3) SHA-256
 * duplicate-content check against the organisation's existing assets,
 * (4) StoragePort upload, (5) media_assets row, (6) provenance row in
 * audit_events (`media_staged`). The staged asset carries its own SHA-256 in
 * the provenance description so any later pass can detect duplicate content
 * without reading objects back.
 *
 * Structural no-auto-publish: this use case never touches a publisher, the
 * publishing worker, or Blotato. The staged asset (and its preview link) is
 * the product; the GEN-PUB-A intake slot `resolvedAssetIds` is filled from a
 * stage result downstream — resolution, never publication.
 *
 * Drive references (folder links or folder names, or file links without the
 * public-fetch flag) are recorded as `posting_ref_recorded` provenance rows
 * via recordPostingReference — a deliberate "reference record", never a
 * pretend asset. Fetching folder listings needs the authenticated Google
 * Drive backend (google-workspace skill OAuth token) and is a documented
 * follow-up, not a silently-skipped step.
 */

export const STAGING_AUDIT_EVENT_TYPE = "media_staged";
export const STAGING_REFERENCE_EVENT_TYPE = "posting_ref_recorded";
export const STAGING_CATEGORY = "posting-request";
export const STAGING_DESCRIPTION_PREFIX = "GEN_PUB_B";

export interface StagingFileInput {
  fileName: string;
  mimeType: string;
  /** Exact file bytes. Size is derived from the buffer — never caller-claimed. */
  bytes: Uint8Array;
}

export interface StageAssetsInput {
  organisationId: string;
  /** Staging actor profile id (owner-approved operator or the acting user). */
  uploadedBy: string;
  requestId: string;
  platforms: readonly PostingPlatform[];
  source: StagingSourceKind;
  /** Verbatim Drive folder/file link or folder NAME, exactly as received. */
  driveRefRaw: string | null;
  /** True only when the link's own bytes were actually fetched this run. */
  linkVerified: boolean;
  files: readonly StagingFileInput[];
  /** Atlas path the bytes came from (atlas_path source). */
  atlasPath?: string | null;
}

export interface StagedSkip {
  fileName?: string;
  code: StagingStop["code"];
  message: string;
}

export interface StagingProvenanceRow {
  assetId: string | null;
  auditEventId: string;
  organisationId: string;
  requestId: string;
  sha256: string | null;
  source: StagingSourceKind;
  driveRefRaw: string | null;
  linkVerified: boolean;
}

export interface StageAssetsResult {
  staged: StagedPostingAsset[];
  skips: StagedSkip[];
  /** One row per staged asset, plus one row when a Drive ref was recorded. */
  provenanceRows: StagingProvenanceRow[];
}

export interface StageAssetsDeps {
  media: Pick<
    MediaRepository,
    "listAssets" | "getAsset" | "createAsset" | "updateAssetMetadata" | "archiveAsset"
  >;
  storage: Pick<StoragePort, "uploadMedia" | "getSignedUrl" | "deleteMedia">;
  audits: Pick<AuditRepository, "recordEvent">;
}

interface PriorStagingRecord {
  assetId: string;
  sha256: string;
  requestId: string | null;
}

/**
 * The provenance description is the durable dedupe index: the asset carries
 * its own sha256 so any later staging pass can detect the same bytes without
 * reading the objects back.
 */
export function parseStagingDescription(description: string | null): {
  sha256: string;
  requestId: string | null;
} | null {
  if (!description || !description.startsWith(`${STAGING_DESCRIPTION_PREFIX}|`)) return null;
  const fields = new Map<string, string>();
  for (const part of description.split("|")) {
    const eq = part.indexOf("=");
    if (eq > 0) fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const sha256 = fields.get("sha256");
  if (!sha256) return null;
  return { sha256, requestId: fields.get("request") ?? null };
}

function priorStagingRecords(
  assets: Awaited<ReturnType<MediaRepository["listAssets"]>>,
): PriorStagingRecord[] {
  const records: PriorStagingRecord[] = [];
  for (const asset of assets) {
    const parsed = parseStagingDescription(asset.description);
    if (parsed) records.push({ assetId: asset.id, sha256: parsed.sha256, requestId: parsed.requestId });
  }
  return records;
}

function stagingDescription(input: {
  sha256: string;
  requestId: string;
  source: StagingSourceKind;
  driveRefRaw: string | null;
  linkVerified: boolean;
  platforms: readonly PostingPlatform[];
}): string {
  return [
    `${STAGING_DESCRIPTION_PREFIX}|sha256=${input.sha256}`,
    `request=${input.requestId}`,
    `source=${input.source}`,
    `ref=${input.driveRefRaw ?? ""}`,
    `link_verified=${input.linkVerified ? 1 : 0}`,
    `platforms=${input.platforms.join("+")}`,
  ].join("|");
}

/**
 * The one governed staging pass. Idempotent for identical bytes: a file whose
 * SHA-256 already sits on an organisation asset (per its provenance
 * description) returns the existing asset with duplicateOf set and no second
 * storage object.
 */
export async function stagePostingAssets(
  deps: StageAssetsDeps,
  input: StageAssetsInput,
): Promise<StageAssetsResult> {
  const staged: StagedPostingAsset[] = [];
  const skips: StagedSkip[] = [];
  const provenanceRows: StagingProvenanceRow[] = [];

  const existingAssets = await deps.media.listAssets(input.organisationId);
  const priors = priorStagingRecords(existingAssets);
  const seenThisRun = new Map<string, string>(); // sha256 → assetId created this run
  const firstPlatform = input.platforms[0];
  if (!firstPlatform) {
    throw new Error("At least one posting platform must be provided for staging.");
  }

  for (const file of input.files) {
    const sizeBytes = file.bytes.byteLength;

    const check = stageAssetCheck({
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes,
      platforms: input.platforms,
    });
    if (!check.valid) {
      skips.push({ fileName: file.fileName, code: check.stop.code, message: check.stop.message });
      continue;
    }

    const sha256 = createHash("sha256").update(file.bytes).digest("hex");

    const priorRecord = priors.find((record) => record.sha256 === sha256);
    const priorAssetId = priorRecord?.assetId
      ?? seenThisRun.get(sha256)
      ?? (await findAssetBySha(deps.media, input.organisationId, sha256));

    if (priorAssetId) {
      const asset = await deps.media.getAsset(input.organisationId, priorAssetId);
      if (asset) {
        const previewUrl = await safePreviewUrl(deps.storage, asset.storagePath);
        staged.push({
          assetId: asset.id,
          organisationId: asset.organisationId,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          storagePath: asset.storagePath,
          platform: firstPlatform,
          platformSpecs: input.platforms.map((platform) => ({
            platform,
            citation: PLATFORM_IMAGE_SPECS[platform].citation,
            withinSpec: checkPlatformVerdict(platform, asset.mimeType, asset.sizeBytes),
          })),
          sha256,
          duplicateOf: priorAssetId,
          source: input.source,
          driveRef: null,
          linkVerified: input.linkVerified,
          previewUrl,
        });
        continue;
      }
    }

    let storagePath: string;
    try {
      storagePath = await deps.storage.uploadMedia(input.organisationId, {
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileBuffer: file.bytes,
      });
    } catch (error) {
      skips.push({
        fileName: file.fileName,
        code: "STORAGE_UPLOAD_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    let asset;
    try {
      asset = await deps.media.createAsset(
        input.organisationId,
        storagePath,
        file.fileName,
        file.mimeType,
        sizeBytes,
        input.uploadedBy,
      );
    } catch (error) {
      // Row failed after the object landed — remove the orphan per repo
      // doctrine (registration-time compensating cleanup, no silent residue).
      try { await deps.storage.deleteMedia(storagePath); } catch { /* best-effort */ }
      skips.push({
        fileName: file.fileName,
        code: "STAGING_SESSION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const description = stagingDescription({
      sha256,
      requestId: input.requestId,
      source: input.source,
      driveRefRaw: input.driveRefRaw,
      linkVerified: input.linkVerified,
      platforms: input.platforms,
    });
    try {
      await deps.media.updateAssetMetadata(asset.id, {
        title: file.fileName,
        thumbnailPath: null,
        category: STAGING_CATEGORY,
        description,
        altText: null,
        tags: [`stage:${input.requestId}`, `sha256:${sha256}`],
        brand: null,
        duration: null,
        copyrightOwner: null,
        usageRights: null,
        expiresAt: null,
        isAiGenerated: false,
        isArchived: false,
      });
    } catch (error) {
      // Provenance is a hard requirement of this lane. An asset without its
      // provenance row must never survive staging half-marked: the storage
      // object is removed immediately, and the half-marked row is archived in
      // place with a `provenance_failed` marker so it can neither pass as
      // staged nor be silently mistaken for live library inventory. (The
      // MediaRepository port has no hard-delete; permanent deletion is the
      // governed two-phase safe-delete path, deliberately out of scope here.)
      try { await deps.storage.deleteMedia(storagePath); } catch { /* best-effort */ }
      const provenanceFailedTags = [`stage:${input.requestId}`, "provenance_failed"];
      let archived = false;
      try {
        await deps.media.archiveAsset(input.organisationId, asset.id, provenanceFailedTags);
        archived = true;
      } catch { /* best-effort archive; the fallback metadata update below remains best-effort */ }
      if (archived) {
        try {
          await deps.media.updateAssetMetadata(asset.id, {
            title: file.fileName, thumbnailPath: null, category: STAGING_CATEGORY,
            description: null, altText: null,
            tags: [`stage:${input.requestId}`, "provenance_failed"],
            brand: null, duration: null, copyrightOwner: null, usageRights: null,
            expiresAt: null, isAiGenerated: false, isArchived: true,
          });
        } catch { /* the archive marker above is the durable half */ }
      }
      skips.push({
        fileName: file.fileName,
        code: "STAGING_SESSION_FAILED",
        message: `provenance enrichment failed for asset ${asset.id}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    let auditEventId: string;
    try {
      const event = await deps.audits.recordEvent({
        organisationId: input.organisationId,
        draftId: null,
        actorId: input.uploadedBy,
        eventType: STAGING_AUDIT_EVENT_TYPE,
        description: `Posted asset staged: ${file.fileName} (${file.mimeType}, ${sizeBytes} bytes)`,
        metadata: {
          requestId: input.requestId,
          assetId: asset.id,
          storagePath,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes,
          sha256,
          source: input.source,
          driveRefRaw: input.driveRefRaw,
          linkVerified: input.linkVerified,
          atlasPath: input.atlasPath ?? null,
          platforms: [...input.platforms],
          platformSpecs: input.platforms.map((platform) => ({
            platform,
            citation: PLATFORM_IMAGE_SPECS[platform].citation,
            withinSpec: checkPlatformVerdict(platform, file.mimeType, sizeBytes),
          })),
          previewPath: storagePath,
        },
      });
      auditEventId = event.id;
    } catch (error) {
      try { await deps.storage.deleteMedia(storagePath); } catch { /* best-effort */ }
      // The provenance row is a hard requirement: the half-staged asset must
      // never survive as live library inventory. Mirror the enrichment-failure
      // cleanup — archive the row in place carrying the `provenance_failed`
      // marker (the durable half), even though the audit event itself failed.
      let archived = false;
      try {
        await deps.media.archiveAsset(input.organisationId, asset.id, [
          `stage:${input.requestId}`,
          "provenance_failed",
        ]);
        archived = true;
      } catch { /* best-effort archive; permanent deletion is the governed two-phase path */ }
      if (archived) {
        try {
          await deps.media.updateAssetMetadata(asset.id, {
            title: file.fileName, thumbnailPath: null, category: STAGING_CATEGORY,
            description: null, altText: null,
            tags: [`stage:${input.requestId}`, "provenance_failed"],
            brand: null, duration: null, copyrightOwner: null, usageRights: null,
            expiresAt: null, isAiGenerated: false, isArchived: true,
          });
        } catch { /* the archive marker above is the durable half */ }
      }
      skips.push({
        fileName: file.fileName,
        code: "STAGING_SESSION_FAILED",
        message: `provenance row failed for asset ${asset.id}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    seenThisRun.set(sha256, asset.id);
    const previewUrl = await safePreviewUrl(deps.storage, storagePath);
    staged.push({
      assetId: asset.id,
      organisationId: input.organisationId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes,
      storagePath,
      platform: firstPlatform,
      platformSpecs: input.platforms.map((platform) => ({
        platform,
        citation: PLATFORM_IMAGE_SPECS[platform].citation,
        withinSpec: checkPlatformVerdict(platform, file.mimeType, sizeBytes),
      })),
      sha256,
      duplicateOf: null,
      source: input.source,
      driveRef: null,
      linkVerified: input.linkVerified,
      previewUrl,
    });
    provenanceRows.push({
      assetId: asset.id,
      auditEventId,
      organisationId: input.organisationId,
      requestId: input.requestId,
      sha256,
      source: input.source,
      driveRefRaw: input.driveRefRaw,
      linkVerified: input.linkVerified,
    });
  }

  return { staged, skips, provenanceRows };
}

/**
 * Records a Drive link (folder or file) as a first-class reference row —
 * provenance exists, no asset bytes are claimed. `linkVerified` stays false
 * unless the caller actually fetched content for this link this run.
 */
export async function recordPostingReference(
  deps: Pick<StageAssetsDeps, "audits">,
  input: {
    organisationId: string;
    actorId: string;
    requestId: string;
    driveRefRaw: string;
    parsedKind: "folder" | "file" | "unknown";
    parsedId: string | null;
    platforms: readonly PostingPlatform[];
    source: StagingSourceKind;
    note?: string;
  },
): Promise<StagingProvenanceRow> {
  const event = await deps.audits.recordEvent({
    organisationId: input.organisationId,
    draftId: null,
    actorId: input.actorId,
    eventType: STAGING_REFERENCE_EVENT_TYPE,
    description: `Posting reference recorded (${input.parsedKind}): ${input.driveRefRaw}`,
    metadata: {
      requestId: input.requestId,
      driveRefRaw: input.driveRefRaw,
      driveRefKind: input.parsedKind,
      driveRefId: input.parsedId,
      linkVerified: false,
      source: input.source,
      platforms: [...input.platforms],
      note: input.note ?? "Reference only — no bytes ingested. Folder listing needs the authenticated Drive backend (documented follow-up).",
    },
  });
  return {
    assetId: null,
    auditEventId: event.id,
    organisationId: input.organisationId,
    requestId: input.requestId,
    sha256: null,
    source: input.source,
    driveRefRaw: input.driveRefRaw,
    linkVerified: false,
  };
}

/** Preview URLs are review conveniences — a failure never blocks staging. */
async function safePreviewUrl(storage: StageAssetsDeps["storage"], storagePath: string): Promise<string | null> {
  try {
    return await storage.getSignedUrl(storagePath, 24 * 60 * 60);
  } catch {
    return null;
  }
}

function checkPlatformVerdict(platform: PostingPlatform, mimeType: string, sizeBytes: number): boolean {
  const spec = PLATFORM_IMAGE_SPECS[platform];
  return spec.mimeTypes.includes(mimeType) && sizeBytes <= spec.maxSizeBytes;
}

async function findAssetBySha(
  media: StageAssetsDeps["media"],
  organisationId: string,
  sha256: string,
): Promise<string | null> {
  const tagged = await media.listAssets(organisationId, { category: STAGING_CATEGORY });
  for (const asset of tagged) {
    if (asset.tags.includes(`sha256:${sha256}`)) return asset.id;
  }
  return null;
}