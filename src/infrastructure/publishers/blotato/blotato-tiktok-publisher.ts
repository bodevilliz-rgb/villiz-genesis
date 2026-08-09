import "server-only";
import { BlotatoPublisherBase } from "./blotato-publisher-base";

/**
 * TikTok's Blotato target schema requires these 7 fields on every publish —
 * verified against help.blotato.com/api/llm and
 * help.blotato.com/api/openapi-reference/publishing (Sprint 1, fix/tiktok-
 * publishing). Genesis has no per-draft UI or data model yet for TikTok's
 * disclosure/audience settings (privacy level, duet/stitch/comment
 * permissions, branded-content and AI-generated disclosure), so Sprint 1
 * ships the conservative, standard "ordinary public organic post" default
 * for every field below rather than inventing per-draft controls this
 * sprint didn't scope.
 *
 * KNOWN LIMITATION (Sprint 1 return report item 28): isAiGenerated is
 * hardcoded false. TikTok's content policy requires accurate AI-generated
 * content disclosure, and Genesis cannot yet reliably infer "was this
 * drafted with Awo" per-post — a future sprint must add an operator-facing
 * control for this before Awo-assisted TikTok content is treated as safe
 * to mark isAiGenerated:false. Until then this is a known compliance gap,
 * not a proven-safe default, and should be reviewed before live TikTok
 * publishing of AI-assisted content.
 */
export const DEFAULT_TIKTOK_TARGET_OPTIONS = {
  privacyLevel: "PUBLIC_TO_EVERYONE",
  disabledComments: false,
  disabledDuet: false,
  disabledStitch: false,
  isBrandedContent: false,
  isYourBrand: false,
  isAiGenerated: false,
} as const;

export class BlotatoTikTokPublisher extends BlotatoPublisherBase {
  readonly platform = "tiktok" as const;

  protected override buildTargetOptions(): Record<string, unknown> {
    return { ...DEFAULT_TIKTOK_TARGET_OPTIONS };
  }
}
