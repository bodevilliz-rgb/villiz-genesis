import type { ContentRepository } from "@/core/application/ports/content-port";
import type { MediaRepository } from "@/core/application/ports/media-port";
import type { ContentDraft } from "@/core/domain/entities/content";
import {
  evaluatePlatformPreflight,
  type PlatformPreflightResult,
  type CommercialDisclosure,
} from "@/core/domain/entities/publishing-preflight";
import {
  filterAssetsForOrganisation,
  isPublishableMediaAsset,
} from "@/core/domain/entities/publishing-media";
import type { PublishingPlatform } from "@/core/domain/entities/publishing";

/**
 * Dependency contract for checkPublishingPreflight.
 */
export interface PublishingPreflightDeps {
  content: ContentRepository;
  media: MediaRepository;
}

/**
 * Input contract for checkPublishingPreflight.
 */
export interface PublishingPreflightInput {
  organisationId: string;
  draftId: string;
  platform: PublishingPlatform;
  /**
   * The operator's AI-generated-content declaration for this publish —
   * from the form at job creation, or from the persisted job row on retry.
   * Omitting it is fail-closed for platforms that require the declaration.
   */
  aiGeneratedDisclosure?: boolean | null;
  /**
   * The operator's commercial-content declarations for this publish —
   * from the form at job creation, or from the persisted job row on retry.
   * Omitting it (or leaving either field null) is fail-closed for platforms
   * that require the disclosure.
   */
  commercialDisclosure?: CommercialDisclosure | null;
}

/**
 * Fetches the draft body and org-isolated media count for a given draft, then
 * delegates to evaluatePlatformPreflight (pure, no IO) for the verdict.
 *
 * Called at two points:
 *   1. Job creation — server actions enforce preflight when livePublishingEnabled.
 *   2. UI preflight panel — getPlatformPreflightAction exposes this to the dialog
 *      so the operator sees a deterministic pass/fail before submitting.
 *
 * Fail-closed error handling: if either the ContentRepository or
 * MediaRepository throws (database connection loss, timeout, etc.), this
 * function does NOT crash — it returns a deterministic PlatformPreflightResult
 * with `ready: false` and a blocker message containing "unavailable". The
 * simulation path remains available so an operator can still preview in
 * non-live mode.
 */
export async function checkPublishingPreflight(
  deps: PublishingPreflightDeps,
  input: PublishingPreflightInput,
): Promise<PlatformPreflightResult> {
  let draft: ContentDraft | null = null;
  let allAssets: Awaited<ReturnType<MediaRepository["listAssetsForDraft"]>> = [];

  try {
    [draft, allAssets] = await Promise.all([
      deps.content.findDraft(input.organisationId, input.draftId),
      deps.media.listAssetsForDraft(input.draftId),
    ]);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during preflight fetch";
    void _preflightLogger({
      level: "error",
      operation: "checkPublishingPreflight.fetch",
      organisationId: input.organisationId,
      draftId: input.draftId,
      platform: input.platform,
      error: errorMessage,
    });
    return {
      ready: false,
      simulationAllowed: true,
      blockers: [
        `A data source required for preflight was unavailable. Please retry or contact support. Detail: ${errorMessage}`,
      ],
    };
  }

  // Fail-closed: a missing draft means there is nothing to publish.
  if (!draft) {
    void _preflightLogger({
      level: "warn",
      operation: "checkPublishingPreflight.draftNotFound",
      organisationId: input.organisationId,
      draftId: input.draftId,
      platform: input.platform,
    });
    return {
      ready: false,
      simulationAllowed: true,
      blockers: [`Draft ${input.draftId} not found for organisation ${input.organisationId}.`],
    };
  }

  const body = draft.body ?? "";
  const { allowed, rejected } = filterAssetsForOrganisation(allAssets, input.organisationId);
  const publishableCount = allowed.filter(isPublishableMediaAsset).length;

  // Log if any foreign-org assets were filtered out — useful for detecting
  // a data-integrity issue without exposing asset details or URLs.
  if (rejected.length > 0) {
    void _preflightLogger({
      level: "warn",
      operation: "checkPublishingPreflight.foreignAssetFiltered",
      organisationId: input.organisationId,
      draftId: input.draftId,
      platform: input.platform,
      rejectedCount: rejected.length,
    });
  }

  const result = evaluatePlatformPreflight(
    input.platform,
    body,
    publishableCount,
    draft.hashtags ?? [],
    input.aiGeneratedDisclosure,
    input.commercialDisclosure,
  );

  void _preflightLogger({
    level: "info",
    operation: "checkPublishingPreflight.complete",
    organisationId: input.organisationId,
    draftId: input.draftId,
    platform: input.platform,
    ready: result.ready,
    blockerCount: result.blockers.length,
  });

  return result;
}

/**
 * Structured logger stub for preflight operations.
 *
 * In production this routes to the centralised application logger. The
 * structure is deliberately minimal: no draft body, no captions, no asset
 * URLs, no account IDs — only operational identifiers needed to correlate
 * log lines. Use `redactMediaUrl` and `redactAccountId` from the media
 * entities module if future code needs to log asset/account references.
 */
interface PreflightLogEntry {
  level: "info" | "warn" | "error";
  operation: string;
  organisationId: string;
  draftId: string;
  platform: PublishingPlatform;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function _preflightLogger(entry: PreflightLogEntry): void {
  // No-op stub. In production, wire this to your logger:
  //   logger.log(entry.level, entry.operation, { ...entry, timestamp: new Date().toISOString() });
  // Credentials, draft bodies, and raw asset URLs are NEVER logged here.
  void entry;
}
