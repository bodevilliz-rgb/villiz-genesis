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
  platformCtx: string = "general social media"
): Promise<PrePublishReport> {
  // Basic programmatic checks
  const hasLinks = /https?:\/\//.test(draft.body);
  const brokenLinks = hasLinks ? false : false; // Placeholder
  const missingMedia = draft.assets ? draft.assets.length === 0 : true;

  try {
    const ai = getAIProvider();

    const systemPrompt = `You are an elite Pre-Publish Editor for a social media platform.
Analyze the draft for readiness. Score it 0-100.
Platform: ${platformCtx}
Brand Voice Context: ${brandVoiceCtx || "Professional and engaging"}

Draft Title: ${draft.title}
Body:
${draft.body}

Analyse:
1. Brand Voice Alignment
2. Readability
3. CTA Quality
4. Platform Optimisation (does it fit ${platformCtx}?)
5. Hashtag Quality
6. Accessibility (e.g. emoji use, formatting)
7. Compliance (any risky, offensive, or disallowed content?)

Provide your analysis matching the JSON schema. 'recommendations' should be specific actionable advice.`;

    const analysis = await ai.generateObject(draft.body, prePublishSchema, { systemPrompt });

    return {
      ...analysis,
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
      hashtagQuality: "missing",
      accessibility: "poor",
      compliance: "flagged",
      missingMedia,
      brokenLinks,
      recommendations: [`AI review unavailable: ${reason}. Publishing requires manual judgement.`],
    };
  }
}
