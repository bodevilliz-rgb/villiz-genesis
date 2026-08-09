import "server-only";
import type { PublishInput } from "@/core/application/ports/publisher-port";
import { BlotatoPublisherBase } from "./blotato-publisher-base";

/**
 * TikTok's Blotato target schema requires 7 fields on every publish —
 * verified against help.blotato.com/api/llm and
 * help.blotato.com/api/openapi-reference/publishing. Compliance-field
 * audit (pre-merge correction, feature/tiktok-publishing):
 *
 *   PRODUCT DEFAULTS (safe — engagement/visibility settings, not
 *   truthfulness declarations; each matches TikTok's own default for an
 *   ordinary public organic post, and a wrong value affects reach or
 *   interaction options, never the honesty of a disclosure):
 *     privacyLevel: "PUBLIC_TO_EVERYONE" — Genesis's purpose is public
 *       client publishing; private/draft posting is a product feature to
 *       add deliberately, not a compliance question.
 *     disabledComments / disabledDuet / disabledStitch: false — TikTok's
 *       own permissive defaults; operator control over these is a future
 *       product feature, not a compliance requirement.
 *
 *   PER-POST DECLARATIONS (content-specific truth claims Genesis must
 *   never blanket-default):
 *     isAiGenerated — GOVERNED as of this correction: captured from an
 *       explicit operator Yes/No in the publishing panel, persisted on the
 *       job row (publishing_jobs.is_ai_generated), enforced non-null by
 *       deterministic preflight at job creation AND worker execution, and
 *       read from PublishInput here. Never defaulted, never inferred.
 *     isBrandedContent / isYourBrand — SAME CLASS of declaration (TikTok's
 *       commercial-content disclosure: paid third-party partnership /
 *       promoting one's own business). Still product-defaulted to false in
 *       this sprint, per "return the audit before expanding scope" — this
 *       is only truthful for organic, non-paid, non-promotional posts.
 *       DOCUMENTED LIMITATION: do not publish paid-partnership or
 *       commercial-disclosure-requiring TikTok content through Genesis
 *       until these two get the same governed operator control
 *       isAiGenerated now has.
 */
export const TIKTOK_PRODUCT_DEFAULT_TARGET_OPTIONS = {
  privacyLevel: "PUBLIC_TO_EVERYONE",
  disabledComments: false,
  disabledDuet: false,
  disabledStitch: false,
  isBrandedContent: false,
  isYourBrand: false,
} as const;

export class BlotatoTikTokPublisher extends BlotatoPublisherBase {
  readonly platform = "tiktok" as const;

  protected override buildTargetOptions(input: PublishInput): Record<string, unknown> {
    // Defense in depth behind the preflight (which blocks an undeclared
    // value at both job creation and worker execution, in live mode): this
    // method only runs on the live path, and sending a fabricated
    // isAiGenerated is exactly the compliance defect this class exists to
    // prevent — so an unreachable-in-practice null refuses loudly instead
    // of silently defaulting. The worker records the throw as a failed
    // attempt; the job is never lost.
    if (input.isAiGenerated === null || input.isAiGenerated === undefined) {
      throw new Error(
        "TikTok publish reached the provider layer without an AI-generated content declaration — preflight should have blocked this. Refusing to send a fabricated value.",
      );
    }
    return { ...TIKTOK_PRODUCT_DEFAULT_TARGET_OPTIONS, isAiGenerated: input.isAiGenerated };
  }
}
