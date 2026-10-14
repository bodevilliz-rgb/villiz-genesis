"use server";

import { revalidatePath } from "next/cache";

import { requireContext } from "../container";
import { errorState, successState } from "../action-result";
import { routes } from "@/lib/routes";
import { stagePostingAssets, type StageAssetsResult } from "@/core/application/use-cases/staging/stage-posting-assets";
import type { PostingPlatform } from "@/core/domain/entities/media-staging";

const STAGING_PLATFORMS = new Set<PostingPlatform>(["instagram", "tiktok"]);

export interface StagePostingAssetsActionInput {
  organisationId: string;
  requestId: string;
  platforms: string[];
  source: "drive_folder" | "drive_file" | "atlas_path" | "direct_upload";
  driveRefRaw: string | null;
  linkVerified: boolean;
  atlasPath?: string | null;
  files: { fileName: string; mimeType: string; bytes: Uint8Array }[];
}

export interface StagePostingAssetsActionResult extends ReturnType<typeof successState> {
  /** Populated on success: the full staging outcome (staged + skips + provenance). */
  staging?: StageAssetsResult;
}

/**
 * GEN-PUB-B server adapter: stage posting assets into the governed Media
 * Library. Deliberately returns staged assets + skips; it never publishes —
 * publication lives behind the publishing worker and its own gates. The
 * first staged asset's id rides `resourceId`; the full outcome rides
 * `staging`.
 */
export async function stagePostingAssetsAction(input: StagePostingAssetsActionInput): Promise<StagePostingAssetsActionResult> {
  try {
    const context = await requireContext();

    const role = context.actor.isPlatformAdmin ? null : await context.organisations.viewerRole(input.organisationId);
    if (role === null && !context.actor.isPlatformAdmin) {
      return { status: "error", message: "You do not have access to this organisation's Media Library." };
    }

    // Fail closed on anything outside the governed staging contract: an
    // unsupported platform name is an input contract violation, never a
    // silently-narrowed request.
    const unsupported = input.platforms.filter(
      (platform) => !STAGING_PLATFORMS.has(platform as PostingPlatform),
    );
    if (unsupported.length > 0) {
      return {
        status: "error",
        message: `Unsupported platform(s): ${unsupported.join(", ")}. Supported: instagram, tiktok.`,
      };
    }
    const platforms = input.platforms as PostingPlatform[];

    const result = await stagePostingAssets(
      { media: context.media, storage: context.storage, audits: context.audits },
      {
        organisationId: input.organisationId,
        uploadedBy: context.actor.id,
        requestId: input.requestId,
        platforms,
        source: input.source,
        driveRefRaw: input.driveRefRaw,
        linkVerified: input.linkVerified,
        atlasPath: input.atlasPath ?? null,
        files: input.files,
      },
    );

    revalidatePath(routes.organisations.media.index(input.organisationId));
    revalidatePath(routes.organisations.detail(input.organisationId));
    for (const staged of result.staged) {
      revalidatePath(routes.organisations.media.detail(input.organisationId, staged.assetId));
    }

    return { ...successState(`Staged ${result.staged.length} asset(s).`), resourceId: result.staged[0]?.assetId, staging: result };
  } catch (error) {
    return errorState(error);
  }
}