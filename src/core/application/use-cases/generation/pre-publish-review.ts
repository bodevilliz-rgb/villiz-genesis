import { z } from "zod";
import { getAIProvider } from "@/infrastructure/ai/provider-factory";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { PublishingPlatform } from "@/core/domain/entities/publishing";
import { evaluateHashtagPolicy, hashtagPolicyViolationMessage } from "@/core/domain/entities/platform-policy";

export interface PrePublishReport {
  score: number; // 0 to 100
  brandVoiceAlignment: "high" | "medium" | "low";
  readability: "easy" | "moderate" | "difficult";
  ctaQuality: "strong" | "weak" | "missing";
  platformOptimisation: "high" | "medium" | "low";
  /** "spammy" is repurposed here to mean "exceeds the destination platform's hashtag limit" once a platform is known — see hashtagPolicyMessage for the exact operator-facing reason. */
  hashtagQuality: "optimal" | "spammy" | "missing" | "not_applicable";
  /** Set only when hashtagQuality === "spammy" for a known platform — the exact deterministic reason, word-for-word identical to the preflight blocker (see platform-policy.ts). Never present when the platform isn't yet known — the review can't enforce a limit it hasn't been told. */
  hashtagPolicyMessage: string | null;
  accessibility: "good" | "poor";
  compliance: "pass" | "flagged";
  missingMedia: boolean;
  brokenLinks: boolean;
  recommendations: string[];
}

export const prePublishSchema = z.object({
  score: z.number().min(0).max(100),
  brandVoiceAlignment: z.enum(["high", "medium", "low"]),
  readability: z.enum(["easy", "moderate", "difficult"]),
  ctaQuality: z.enum(["strong", "weak", "missing"]),
  platformOptimisation: z.enum(["high", "medium", "low"]),
  hashtagQuality: z.enum(["optimal", "spammy", "missing", "not_applicable"]),
  accessibility: z.enum(["good", "poor"]),
  compliance: z.enum(["pass", "flagged"]),
  recommendations: z.array(z.string()),
});

/**
 * The AI provider is optional infrastructure (no API key is configured in
 * local development, and a live key can still fail transiently in
 * production) — it must never be able to crash the publish flow itself.
 * Sprint 5 root-cause finding: this function previously let a provider error
 * (e.g. AI_LoadAPIKeyError) propagate uncaught, which surfaced as an
 * unhandled 500 on the review workspace page and left "Publish Anyway"
 * permanently disabled (the dialog's button is disabled whenever `report`
 * is null, and a thrown promise here means `report` is never set). Any
 * provider failure now degrades to a clearly-labelled unavailable report
 * instead of throwing, so a human can always still make the publish call.
 */
export async function analyzeDraftForPublishing(
  draft: ContentDraft,
  brandVoiceCtx: string,
  platformCtx: string = "general social media",
  publishableMediaCount?: number,
  /** The actual destination platform, when known — drives the canonical hashtag-limit check. Kept separate from `platformCtx` (a free-text string used only in the AI prompt) so every existing call site that doesn't yet know the platform keeps working unchanged. */
  platform?: PublishingPlatform | null,
): Promise<PrePublishReport> {
  // Basic programmatic checks
  const hasLinks = /https?:\/\//.test(draft.body);
  const brokenLinks = hasLinks ? false : false; // Placeholder
  // When the caller supplies an org-isolated publishable count (preferred),
  // use it. Fall back to draft.assets only when the count is not provided —
  // draft.assets is a partially-loaded optional relation that is often absent
  // when the draft is passed from a client component to a server action.
  const missingMedia =
    publishableMediaCount !== undefined
      ? publishableMediaCount === 0
      : draft.assets
        ? draft.assets.length === 0
        : true;

  // Hashtag quality is determined deterministically from the dedicated
  // hashtags field — not by inspecting the body for # characters. This
  // ensures the pre-publish report is stable once the first-class field
  // exists, and prevents the AI from being confused by body text that
  // happens to contain #-prefixed words.
  //
  // "spammy" here specifically means "exceeds the destination platform's
  // verified hashtag limit" — the exact case that produced a live Blotato
  // 422 for a scheduled Instagram job with 6 hashtags while this function
  // reported "optimal" (it only ever checked presence, never a limit).
  // Only evaluated once a destination platform is known; the review can't
  // enforce a limit for a platform that hasn't been selected yet.
  const hashtags = draft.hashtags ?? [];
  let hashtagQuality: PrePublishReport["hashtagQuality"];
  let hashtagPolicyMessage: string | null = null;
  if (platform === "linkedin" && hashtags.length === 0) {
    // Genesis' audited LinkedIn personal-profile mode deliberately generates
    // clean keyword-rich copy without hashtags. Do not let the older generic
    // social checker penalise that approved platform-specific policy.
    hashtagQuality = "not_applicable";
  } else if (hashtags.length === 0) {
    hashtagQuality = "missing";
  } else if (platform) {
    const policy = evaluateHashtagPolicy(platform, hashtags);
    if (policy.exceeds) {
      hashtagQuality = "spammy";
      hashtagPolicyMessage = hashtagPolicyViolationMessage(platform, policy);
    } else {
      hashtagQuality = "optimal";
    }
  } else {
    hashtagQuality = "optimal";
  }

  try {
    const ai = getAIProvider();

    const systemPrompt = `You are an elite Pre-Publish Editor for a social media platform.
Analyze the draft for readiness. Score it 0-100.
Platform: ${platformCtx}
Brand Voice Context: ${brandVoiceCtx || "Professional and engaging"}

Draft Title: ${draft.title}
Body:
${draft.body}

Hashtags (stored separately, will be appended at publish): ${(draft.hashtags ?? []).length > 0 ? (draft.hashtags ?? []).map((h) => `#${h}`).join(" ") : "None"}

Analyse (do NOT evaluate hashtag quality — that is handled separately):
1. Brand Voice Alignment
2. Readability
3. CTA Quality
4. Platform Optimisation (does it fit ${platformCtx}?)
5. Accessibility (e.g. emoji use, formatting)
6. Compliance (any risky, offensive, or disallowed content?)

Provide your analysis matching the JSON schema. 'recommendations' should be specific actionable advice.`;

    const analysis = await ai.generateObject(draft.body, prePublishSchema, { systemPrompt });

    const recommendations = platform === "linkedin" && hashtags.length === 0
      ? analysis.recommendations.filter((recommendation) => !/hashtags?/i.test(recommendation))
      : analysis.recommendations;

    return {
      ...analysis,
      // Deterministic override — the AI's hashtagQuality output is discarded
      // in favour of the value derived from the dedicated hashtags field above.
      hashtagQuality,
      hashtagPolicyMessage,
      missingMedia,
      brokenLinks,
      recommendations,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The AI review provider is unavailable.";
    return {
      score: 0,
      brandVoiceAlignment: "medium",
      readability: "moderate",
      ctaQuality: "missing",
      platformOptimisation: "medium",
      hashtagQuality,
      hashtagPolicyMessage,
      accessibility: "poor",
      compliance: "flagged",
      missingMedia,
      brokenLinks,
      recommendations: [`AI review unavailable: ${reason}. Publishing requires manual judgement.`],
    };
  }
}
