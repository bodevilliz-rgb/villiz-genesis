import { z } from "zod";
import { getAIProvider } from "@/infrastructure/ai/provider-factory";
import type { ContentDraft } from "@/core/domain/entities/content";

export interface PrePublishReport {
  score: number; // 0 to 100
  brandVoiceAlignment: "high" | "medium" | "low";
  readability: "easy" | "moderate" | "difficult";
  ctaQuality: "strong" | "weak" | "missing";
  platformOptimisation: "high" | "medium" | "low";
  hashtagQuality: "optimal" | "spammy" | "missing";
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
  hashtagQuality: z.enum(["optimal", "spammy", "missing"]),
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
  const hashtagQuality: PrePublishReport["hashtagQuality"] =
    (draft.hashtags ?? []).length > 0 ? "optimal" : "missing";

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

    return {
      ...analysis,
      // Deterministic override — the AI's hashtagQuality output is discarded
      // in favour of the value derived from the dedicated hashtags field above.
      hashtagQuality,
      missingMedia,
      brokenLinks,
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
      accessibility: "poor",
      compliance: "flagged",
      missingMedia,
      brokenLinks,
      recommendations: [`AI review unavailable: ${reason}. Publishing requires manual judgement.`],
    };
  }
}
