/**
 * GEN-PUB-B — staged-asset CLI ingest.
 *
 * The operator/assistant-run companion to the governed staging pipeline:
 * takes a source (Drive folder/file link, bare Drive ID, Atlas path or a
 * local directory) plus platform targets, and routes every file through
 * src/core/application/use-cases/staging (bucket-level validation,
 * per-platform provider-cited image specs, duplicate-content hash check,
 * storage upload, media_assets rows, audit_events provenance rows). Preview
 * links are printed for the owner review pass.
 *
 * NO publishing happens here or anywhere in this pipeline — staging only.
 *
 * Ingestion behaviour (fail-closed, no silent defaults):
 *   - Atlas paths / directories: files are read and staged directly.
 *   - Drive file link/ID with --allow-public-fetch: the file is fetched over
 *     its own confirmed public URL (no credentials involved). The fetched
 *     bytes must pass the repo's shared MIME allow-list (media-upload.ts);
 *     anything else (Drive HTML wrappers etc.) is skipped, never staged.
 *   - Drive file link/ID without --allow-public-fetch, or a Drive FOLDER
 *     link: the link itself is recorded as a first-class REFERENCE via
 *     recordPostingReference (`posting_ref_recorded` provenance row) AND the
 *     report carries `SOURCE_LINK_NOT_FETCHED`-style skips with
 *     `linkVerified: false` — nothing pretends folder content was ingested.
 *     Folder listing needs the authenticated Google Drive backend
 *     (google-workspace skill OAuth token) — a documented follow-up, never
 *     silently substituted.
 *
 * Usage:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/stage-posting-assets.ts \
 *     --org "Villiz Pixels UK" \
 *     --source "https://drive.google.com/folders/1AbC..." \
 *     --platforms instagram,tiktok \
 *     [--request <stage-request-id>] \
 *     [--actor-email bodevilliz@gmail.com] \
 *     [--allow-public-fetch]
 *
 * Idempotent for repeat ingests of the same content: assets whose SHA-256
 * already exists in the organisation return with duplicateOf set instead of
 * re-staging a copy.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Loads .env.local (falling back to .env) exactly like the other repo scripts
// — Node's built-in env loader, no extra dependency (see publishing-worker.ts).
for (const candidate of [".env.local", ".env"]) {
  const fullPath = path.resolve(process.cwd(), candidate);
  if (existsSync(fullPath)) process.loadEnvFile(fullPath);
}

import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { SupabaseMediaRepository } from "@/infrastructure/repositories/supabase-media-repository";
import { SupabaseStoragePort } from "@/infrastructure/ports/supabase-storage-port";
import { SupabaseAuditRepository } from "@/infrastructure/repositories/supabase-audit-repository";
import {
  recordPostingReference,
  stagePostingAssets,
} from "@/core/application/use-cases/staging/stage-posting-assets";
import {
  parseDriveRef,
  type DriveRefParseResult,
  type StagingSourceKind,
} from "@/core/domain/entities/media-staging";
import type { MediaRepository } from "@/core/application/ports/media-port";
import type { AuditRepository } from "@/core/application/ports/audit-port";
import type { PostingPlatform } from "@/core/domain/entities/media-staging";

interface SourcePart {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return undefined;
  return process.argv[index + 1];
}

async function collectAtlasSources(source: string): Promise<SourcePart[]> {
  const absolute = path.resolve(source.replace(/^~/, process.env.HOME ?? ""));
  const stat = statSync(absolute);
  const files = stat.isDirectory()
    ? readdirSync(absolute, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(absolute, entry.name))
    : [absolute];

  const parts: SourcePart[] = [];
  for (const file of files) {
    const ext = path.basename(file).split(".").pop()?.toLowerCase() ?? "";
    parts.push({
      fileName: path.basename(file),
      mimeType: MIME_BY_EXT[ext] ?? "",
      bytes: new Uint8Array(await readFile(file)),
    });
  }
  return parts;
}

async function collectDriveFileSource(driveId: string): Promise<SourcePart[]> {
  const url = `https://drive.google.com/uc?export=download&id=${driveId}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `DRIVE_FETCH_FAILED: HTTP ${response.status} — the file link is not publicly fetchable. ` +
        "Confirm the share setting, or provision the authenticated Drive backend (google-workspace skill OAuth token) as documented in docs/GEN_PUB_B_ASSET_STAGING.md.",
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const urlName = decodeURIComponent(new URL(response.url).pathname.split("/").pop() ?? "");
  const fileName =
    /filename="?(.+?)"?$/.exec(disposition)?.[1]?.trim() ||
    new URL(response.url).searchParams.get("filename") ||
    urlName ||
    `${driveId}.bin`;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  const mimeType =
    MIME_BY_EXT[ext] ??
    (contentType.startsWith("image/") || contentType.startsWith("video/") || contentType === "application/pdf"
      ? contentType
      : "");
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The repo's shared MIME allow-list is the gate at the bucket, so a fetch
  // that came back as anything else (typically a Drive HTML wrapper for a
  // virus-scan interstitial) is reported as a skip — never staged.
  if (!mimeType || !MIME_BY_EXT_LISTING.has(mimeType)) {
    throw new Error(
      `DRIVE_FETCH_UNSUPPORTED_TYPE: fetched "${fileName}" (${mimeType || "unknown type"}) is outside the media allow-list — nothing was staged. ` +
        "Use a direct Atlas path instead, or provision the authenticated Drive backend as documented in docs/GEN_PUB_B_ASSET_STAGING.md.",
    );
  }
  if (bytes.byteLength === 0) {
    throw new Error("DRIVE_FETCH_EMPTY: the fetched file has zero bytes — nothing was staged.");
  }
  return [{ fileName, mimeType, bytes }];
}

const MIME_BY_EXT_LISTING = new Set(Object.values(MIME_BY_EXT));

async function resolveSources(
  source: string,
  allowPublicFetch: boolean,
): Promise<{ parts: SourcePart[]; resolvedKind: StagingSourceKind; linkVerified: boolean }> {
  const drive = parseDriveRef(source);

  if (drive.kind === "folder") {
    // Folder listing is an authenticated-API capability this stack does not
    // have yet — the link becomes a first-class reference row (handled by the
    // caller), never a fake part and never a silent skip.
    return { parts: [], resolvedKind: "drive_folder", linkVerified: false };
  }

  if (drive.kind === "file" && drive.id) {
    if (!allowPublicFetch) {
      return { parts: [], resolvedKind: "drive_file", linkVerified: false };
    }
    const parts = await collectDriveFileSource(drive.id);
    return { parts, resolvedKind: "drive_file", linkVerified: parts.length > 0 };
  }

  // Not a Drive ref: treat as an Atlas/local path (fail loudly if it doesn't exist).
  const parts = await collectAtlasSources(source);
  return { parts, resolvedKind: "atlas_path", linkVerified: false };
}

async function main() {
  const orgNameOrId = argValue("--org");
  const source = argValue("--source");
  const platformsArg = argValue("--platforms") ?? "instagram";
  const actorEmail = argValue("--actor-email") ?? "bodevilliz@gmail.com";
  const allowPublicFetch = process.argv.includes("--allow-public-fetch");
  const requestExplicit = argValue("--request");

  if (!orgNameOrId) throw new Error("--org is required (organisation name or UUID)");
  if (!source) throw new Error("--source is required (Drive folder link, Drive file link, or Atlas path)");

  const supportedPlatforms = ["instagram", "tiktok"] as const satisfies readonly PostingPlatform[];
  const platforms = platformsArg
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is (typeof supportedPlatforms)[number] =>
      (supportedPlatforms as readonly string[]).includes(p),
    );
  if (platforms.length === 0) {
    throw new Error(
      `UNSUPPORTED_PLATFORM: supported platforms are ${supportedPlatforms.join(", ")} (received "${platformsArg}")`,
    );
  }

  const admin = createAdminClient();
  const media: MediaRepository = new SupabaseMediaRepository(admin);
  const storage = new SupabaseStoragePort(admin);
  const audits: AuditRepository = new SupabaseAuditRepository(admin);

  const orgs = await admin.from("organisations").select("id, name");
  if (orgs.error) throw new Error(`organisation lookup failed: ${orgs.error.message}`);
  const match = (orgs.data ?? []).find((o) => o.name === orgNameOrId || o.id === orgNameOrId);
  if (!match) {
    throw new Error(
      `UNKNOWN_ORGANISATION: no organisation matches "${orgNameOrId}". Known: ${(orgs.data ?? []).map((o) => o.name).join(", ")}`,
    );
  }

  const profiles = await admin.from("profiles").select("id, email").eq("email", actorEmail);
  if (profiles.error) throw new Error(`profile lookup failed: ${profiles.error.message}`);
  const actor = (profiles.data ?? [])[0];
  if (!actor) throw new Error(`UNKNOWN_ACTOR: no profile has email ${actorEmail}`);

  const drive = parseDriveRef(source);
  const requestId = requestExplicit
    ?? `stage_${Date.now()}_${createHash("sha256").update(source + "|" + orgNameOrId).digest("hex").slice(0, 8)}`;

  if (drive.kind === "folder") {
    // Reference-only lane: the folder link/name is the provenance record.
    // Zero bytes, zero fake parts, zero publishing.
    const referenceRow = await recordPostingReference({ audits }, {
      organisationId: match.id,
      actorId: actor.id,
      requestId,
      driveRefRaw: source,
      parsedKind: "folder",
      parsedId: drive.id,
      platforms,
      source: "drive_folder",
    });
    const report = {
      requestId,
      organisation: { id: match.id, name: match.name },
      actorEmail,
      source,
      resolvedKind: "drive_folder" as StagingSourceKind,
      linkVerified: false,
      staged: [],
      skips: [
        {
          code: "SOURCE_LINK_NOT_FETCHED" as const,
          message:
            "Drive folder link recorded as a reference only — folder listing needs the authenticated Google Drive backend (documented follow-up). No bytes were staged.",
          fileName: source,
        },
      ],
      provenanceRows: [referenceRow],
      previewUrls: {},
    };
    await writeAndPrintReport(report);
    return;
  }

  const { parts, resolvedKind, linkVerified } = await resolveSources(source, allowPublicFetch);

  if (resolvedKind === "drive_file" && parts.length === 0) {
    // File link without --allow-public-fetch: record the reference AND the
    // explicit skip, mirroring the folder lane exactly.
    const referenceRow = await recordPostingReference({ audits }, {
      organisationId: match.id,
      actorId: actor.id,
      requestId,
      driveRefRaw: source,
      parsedKind: "file",
      parsedId: drive.id,
      platforms,
      source: "drive_file",
      note: "File link recorded unverified — pass --allow-public-fetch to fetch over the link's own public URL, or provision the authenticated Drive backend (documented follow-up).",
    });
    const report = {
      requestId,
      organisation: { id: match.id, name: match.name },
      actorEmail,
      source,
      resolvedKind: "drive_file" as StagingSourceKind,
      linkVerified: false,
      staged: [],
      skips: [
        {
          code: "SOURCE_LINK_NOT_FETCHED" as const,
          message:
            "Drive file link recorded as a reference only (linkVerified=false). Re-run with --allow-public-fetch to fetch the file's public bytes, or stage directly from an Atlas path.",
          fileName: source,
        },
      ],
      provenanceRows: [referenceRow],
      previewUrls: {},
    };
    await writeAndPrintReport(report);
    return;
  }

  if (parts.length === 0) throw new Error("SOURCE_EMPTY: no files resolved from the source");

  const staged = await stagePostingAssets(
    { media, storage, audits },
    {
      organisationId: match.id,
      uploadedBy: actor.id,
      requestId,
      platforms,
      source: resolvedKind,
      driveRefRaw: drive.kind !== "unknown" ? source : null,
      linkVerified,
      files: parts,
      atlasPath: resolvedKind === "atlas_path" ? path.resolve(source) : null,
    },
  );

  const previewUrls: Record<string, string> = {};
  for (const asset of staged.staged) {
    previewUrls[asset.assetId] = asset.previewUrl ?? "";
  }

  const report = {
    requestId,
    organisation: { id: match.id, name: match.name },
    actorEmail,
    source,
    resolvedKind,
    linkVerified,
    staged: staged.staged.map((a) => ({
      assetId: a.assetId,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      storagePath: a.storagePath,
      sha256: a.sha256,
      duplicateOf: a.duplicateOf,
      platformSpecs: a.platformSpecs,
      previewUrl: a.previewUrl,
    })),
    skips: staged.skips,
    provenanceRows: staged.provenanceRows,
    previewUrls,
  };

  await writeAndPrintReport(report);
}

async function writeAndPrintReport(report: unknown): Promise<void> {
  const reportPath = process.env.STAGING_REPORT_PATH ?? "/tmp/genesis-staging-report.json";
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error("STAGING_FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});