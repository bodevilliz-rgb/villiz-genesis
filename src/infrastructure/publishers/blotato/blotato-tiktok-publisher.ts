import "server-only";
import type { PublishInput } from "@/core/application/ports/publisher-port";
import { BlotatoPublisherBase } from "./blotato-publisher-base";

/**
 * TikTok's Blotato target schema requires 7 fields on every publish —
 * verified against help.blotato.com/api/llm and
 * help.blotato.com/api/openapi-reference/publishing. Compliance-field
 * audit (feature/tiktok-publishing, two pre-merge corrections):
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
 *   never blanket-default) — ALL THREE now fully governed, none defaulted:
 *     isAiGenerated — captured from an explicit operator Yes/No in the
 *       publishing panel, persisted on the job row
 *       (publishing_jobs.is_ai_generated), enforced non-null by
 *       deterministic preflight at job creation AND worker execution.
 *     isYourBrand / isBrandedContent — TikTok's commercial-content
 *       disclosure (developers.tiktok.com/doc/content-sharing-guidelines):
 *       "Your Brand" (promoting the poster's own business) and "Branded
 *       Content" (paid third-party partnership) are independent booleans —
 *       both may be true. Captured from the publishing panel's Commercial
 *       Content section, persisted on publishing_jobs.is_your_brand /
 *       is_branded_content, enforced non-null (both fields, independently)
 *       by the same deterministic preflight. "No commercial content" is
 *       itself a valid explicit declaration (both false) — what was
 *       removed in this correction is Genesis ever choosing that answer
 *       FOR the operator via a hardcoded default.
 *
 * Not implemented (out of scope, not silently defaulted): TikTok also
 * requires the posting CLIENT (Genesis, not the API payload) to display a
 * Music Usage Confirmation notice before the publish button — see the
 * publishing panel's static disclosure text. That is a UI text obligation,
 * not a target field, so it has no representation in this file.
 */
export const TIKTOK_PRODUCT_DEFAULT_TARGET_OPTIONS = {
  privacyLevel: "PUBLIC_TO_EVERYONE",
  disabledComments: false,
  disabledDuet: false,
  disabledStitch: false,
} as const;

/** Which PublishInput declaration fields feed which target field — kept in one place so the "throw if any are unset" check and the "compose the target" step can never drift apart. */
const REQUIRED_DECLARATIONS = ["isAiGenerated", "isYourBrand", "isBrandedContent"] as const;

export class BlotatoTikTokPublisher extends BlotatoPublisherBase {
  readonly platform = "tiktok" as const;

  protected override buildTargetOptions(input: PublishInput): Record<string, unknown> {
    // Defense in depth behind the preflight (which blocks any undeclared
    // value at both job creation and worker execution, in live mode): this
    // method only runs on the live path, and sending a fabricated
    // declaration is exactly the compliance defect these corrections exist
    // to prevent — so an unreachable-in-practice null refuses loudly
    // instead of silently defaulting. The worker records the throw as a
    // failed attempt; the job is never lost.
    const unset = REQUIRED_DECLARATIONS.filter((key) => input[key] === null || input[key] === undefined);
    if (unset.length > 0) {
      throw new Error(
        `TikTok publish reached the provider layer without a required declaration (${unset.join(", ")}) — preflight should have blocked this. Refusing to send a fabricated value.`,
      );
    }
    return {
      ...TIKTOK_PRODUCT_DEFAULT_TARGET_OPTIONS,
      isAiGenerated: input.isAiGenerated,
      isYourBrand: input.isYourBrand,
      isBrandedContent: input.isBrandedContent,
    };
  }
}
