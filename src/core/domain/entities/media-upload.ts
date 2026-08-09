/**
 * Shared upload-transport rules for organisation media — imported by BOTH the
 * browser (fast-fail UX validation) and the server actions (the authoritative
 * check). Deliberately free of any server-only imports so one module defines
 * one truth for what may be uploaded and where it may land.
 *
 * The MIME list mirrors the `organisation-media` bucket's own
 * `allowed_mime_types` configuration exactly — Supabase Storage enforces that
 * list at write time regardless of what any client claims, so advertising
 * anything broader (the old UI accepted `audio/*`, which the bucket has never
 * accepted) only produces confusing late failures.
 */

export const ORGANISATION_MEDIA_BUCKET = "organisation-media";

export const MEDIA_UPLOAD_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
] as const;

/**
 * 50 MB. The bucket itself is configured to allow up to 500 MB per object,
 * but 50 MB is the limit this product has always advertised and is safely
 * inside every plan-level Supabase global upload cap — the one setting not
 * inspectable from here. Raising this constant is a product decision, not a
 * code fix.
 */
export const MEDIA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export type MediaUploadValidation = { valid: true } | { valid: false; reason: string };

export function validateMediaUpload(input: { mimeType: string; sizeBytes: number }): MediaUploadValidation {
  if (!(MEDIA_UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return {
      valid: false,
      reason: `This file type (${input.mimeType || "unknown"}) is not supported. Supported: JPEG, PNG, WebP, GIF, AVIF, MP4, QuickTime, WebM, PDF.`,
    };
  }
  if (input.sizeBytes <= 0) {
    return { valid: false, reason: "The selected file is empty." };
  }
  if (input.sizeBytes > MEDIA_UPLOAD_MAX_BYTES) {
    const mb = (input.sizeBytes / 1024 / 1024).toFixed(1);
    return { valid: false, reason: `This file is ${mb} MB — the maximum supported upload size is 50 MB.` };
  }
  return { valid: true };
}

/**
 * The server is the only author of storage paths — the browser never supplies
 * one. Filenames are sanitised to a conservative character set so a hostile
 * name can never traverse or restructure the path.
 */
export function buildOrganisationStoragePath(organisationId: string, fileName: string, now = Date.now()): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(-100) || "file";
  return `organisations/${organisationId}/${now}_${safeName}`;
}

/** Registration-time guard: a storage path is only acceptable if it sits inside the claiming organisation's own prefix. */
export function storagePathBelongsToOrganisation(storagePath: string, organisationId: string): boolean {
  if (storagePath.includes("..")) return false;
  return storagePath.startsWith(`organisations/${organisationId}/`);
}
