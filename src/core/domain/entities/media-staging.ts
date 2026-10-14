/**
 * GEN-PUB-B — governed posting-asset staging (domain rules).
 *
 * The staging contract for one-message owner posting: assets referenced from a
 * Drive folder link (or an Atlas path) are validated, deduplicated and staged
 * into an organisation's Media Library with a provenance record — and never
 * published. Publishing stays behind the publishing worker (GEN-PUB-C):
 * nothing in this module knows a publisher exists.
 *
 * Drive is credential-light here on purpose: this stack holds no Google OAuth
 * or service-account credential (verified 2026-10-02 on this branch), so
 * folder and file links are handled as first-class REFERENCES carrying a
 * `linkVerified` flag rather than fetched API objects. The fetch capability
 * is deliberately NOT silently skipped — it is a documented follow-up for the
 * moment the owner provisions Drive credentials.
 *
 * Every numeric constraint below is provider-sourced, never invented:
 * - TikTok image specs (JPEG/WebP up to 20 MB per image; 1080 px is an
 *   export option, not a maximum dimension): Blotato "Supported Posts &
 *   Media" (TikTok), help.blotato.com/social-accounts-and-platform-faqs/
 *   tiktok/supported-posts-and-media (fetched 2026-10-02).
 * - Instagram caption and media constraints: Blotato Instagram platform
 *   docs (help.blotato.com/api-documentation/api-platform/instagram).
 * - Storage-level rules (shared truth with browser + server actions):
 *   ./media-upload.ts — the MIME allow-list mirrors the organisation-media
 *   bucket configuration exactly, and the bucket enforces it at write time.
 */

import {
  MEDIA_UPLOAD_ALLOWED_MIME_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  validateMediaUpload,
  type MediaUploadValidation,
} from "./media-upload";

export type PostingPlatform = "instagram" | "tiktok";

/** Staging source kinds. Drive links are stored verbatim + normalised parts. */
export type StagingSourceKind = "drive_folder" | "drive_file" | "atlas_path" | "direct_upload";

export interface PlatformImageSpec {
  /** Accepted image MIME types for image posts on this platform. */
  mimeTypes: readonly string[];
  /** Maximum image file size in bytes (provider-documented). */
  maxSizeBytes: number;
  /** Human-readable, citation-ready spec line shown to reviewers. */
  citation: string;
  /** Source URL the spec line was fetched from (see file docblock). */
  source: string;
}

export const PLATFORM_IMAGE_SPECS: Record<PostingPlatform, PlatformImageSpec> = {
  instagram: {
    mimeTypes: ["image/jpeg", "image/png"],
    maxSizeBytes: 8 * 1024 * 1024,
    citation: "Instagram: JPEG/PNG up to 8 MB",
    source: "https://help.blotato.com/api-documentation/api-platform/instagram",
  },
  tiktok: {
    mimeTypes: ["image/jpeg", "image/webp"],
    maxSizeBytes: 20 * 1024 * 1024,
    citation: "TikTok: JPEG/WebP up to 20 MB per image (1080 px is an export option, not a cap)",
    source:
      "https://help.blotato.com/social-accounts-and-platform-faqs/tiktok/supported-posts-and-media",
  },
} as const;

/**
 * One Drive reference, parsed. The verbatim string is kept for provenance;
 * `kind: "folder"` with `id: null` means a plain folder NAME was given —
 * resolving it to an id needs Drive credentials (documented follow-up).
 */
export interface DriveRefParseResult {
  kind: "folder" | "file" | "unknown";
  id: string | null;
  raw: string;
}

const DRIVE_FILE_D_RE = /drive\.google\.com\/(?:file\/d\/|uc\?[^ ]*id=|open\?[^ ]*id=)([A-Za-z0-9_-]{10,})/;
const DRIVE_BARE_ID_RE = /^[A-Za-z0-9_-]{25,}$/;

/**
 * Accepts folder links, file links (`/file/d/<id>`), uc/open `id=` links,
 * bare Drive ids, or a plain folder NAME (e.g. "Genesis fliers Sep"). A plain
 * name cannot be resolved to an id without Drive credentials, so it is kept
 * verbatim for provenance. Bare ids are 25+ chars of the Drive alphabet — a
 * folder name that matches that shape is indistinguishable without the API
 * and is treated as an id (documented trade-off).
 */
export function parseDriveRef(raw: string): DriveRefParseResult {
  const value = raw.trim();
  if (!value) return { kind: "unknown", id: null, raw: value };

  const folder = value.match(/drive\.google\.com\/folders\/([A-Za-z0-9_-]{10,})/);
  const file = value.match(DRIVE_FILE_D_RE);
  if (file && file[1]) return { kind: "file", id: file[1], raw: value };
  if (folder && folder[1]) return { kind: "folder", id: folder[1], raw: value };

  if (DRIVE_BARE_ID_RE.test(value)) return { kind: "file", id: value, raw: value };

  return { kind: "folder", id: null, raw: value };
}

/**
 * A staged posting asset: everything a human reviewer — or the GEN-PUB-A
 * `resolvedAssetIds` slot downstream — needs to judge the staged object.
 */
export interface StagedPostingAsset {
  /** media_assets.id after the createAsset round trip. */
  assetId: string;
  organisationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  /** Provider-referenced spec per requested platform. */
  platformSpecs: { platform: PostingPlatform; citation: string; withinSpec: boolean }[];
  /** Platform the staging request targets (first when several). */
  platform: PostingPlatform;
  /** SHA-256 hex of the exact staged bytes. */
  sha256: string;
  /** Set when an older asset in the organisation already held these bytes. */
  duplicateOf: string | null;
  source: StagingSourceKind;
  driveRef: DriveRefParseResult | null;
  linkVerified: boolean;
  /** Short-lived signed preview URL for the owner review pass. */
  previewUrl: string | null;
}

/** Why a file could not be staged. Machine-readable for UI/scripts/QA. */
export interface StagingStop {
  code:
    | "MIME_REJECTED" // bucket-level allow-list failure
    | "EMPTY_FILE"
    | "TOO_LARGE" // bucket-level 50 MB cap
    | "PLATFORM_SPEC_FAIL" // per-platform image spec (mime/size)
    | "STORAGE_UPLOAD_FAILED"
    | "STAGING_SESSION_FAILED"
    | "INTERNAL";
  message: string;
  fileName?: string;
}

export type StagingStopCode = StagingStop["code"];

/**
 * Per-platform spec evaluation. Container checks only (MIME + size): true
 * pixel-dimension checking needs an image-decoding dependency and is a
 * documented follow-up (docs/GEN_PUB_B_ASSET_STAGING.md).
 */
export function evalPlatformSpecs(
  file: { mimeType: string; sizeBytes: number },
  platforms: readonly PostingPlatform[],
): { ok: true } | { ok: false; stop: StagingStop } {
  for (const platform of platforms) {
    const spec = PLATFORM_IMAGE_SPECS[platform];
    if (!spec.mimeTypes.includes(file.mimeType)) {
      return {
        ok: false,
        stop: {
          code: "PLATFORM_SPEC_FAIL",
          message: `${file.mimeType} is not an accepted image type for ${platform} (${spec.citation}).`,
        },
      };
    }
    if (file.sizeBytes > spec.maxSizeBytes) {
      return {
        ok: false,
        stop: {
          code: "PLATFORM_SPEC_FAIL",
          message: `File is ${file.sizeBytes} bytes; ${platform} accepts up to ${spec.maxSizeBytes} (${spec.citation}).`,
        },
      };
    }
  }
  return { ok: true };
}

export interface StageAssetCheckInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  platforms: readonly PostingPlatform[];
}

export type StageAssetCheck = { valid: true } | { valid: false; stop: StagingStop };

function bucketStopCode(validation: MediaUploadValidation, mimeType: string, sizeBytes: number): StagingStopCode {
  if (!mimeType || !(MEDIA_UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) return "MIME_REJECTED";
  if (sizeBytes <= 0) return "EMPTY_FILE";
  if (sizeBytes > MEDIA_UPLOAD_MAX_BYTES) return "TOO_LARGE";
  return "INTERNAL"; // validation.valid === false must always fall in one of the buckets above
}

/**
 * Full pre-storage gate: the shared bucket rules first (allow-list, empty,
 * 50 MB — reusing the exact validation the upload transport already runs so
 * the bucket's own write-time enforcement can never be surprised), then the
 * per-platform spec narrowing.
 */
export function stageAssetCheck(input: StageAssetCheckInput): StageAssetCheck {
  const validation = validateMediaUpload({ mimeType: input.mimeType, sizeBytes: input.sizeBytes });
  if (!validation.valid) {
    return {
      valid: false,
      stop: {
        code: bucketStopCode(validation, input.mimeType, input.sizeBytes),
        message: validation.reason,
        fileName: input.fileName,
      },
    };
  }

  const platformResult = evalPlatformSpecs(
    { mimeType: input.mimeType, sizeBytes: input.sizeBytes },
    input.platforms,
  );
  if (!platformResult.ok) {
    return { valid: false, stop: { ...platformResult.stop, fileName: input.fileName } };
  }
  return { valid: true };
}