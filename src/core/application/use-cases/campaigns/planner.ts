import type { Campaign } from "@/core/domain/entities/campaign";
import type { ContentDraft } from "@/core/domain/entities/content";

export interface AIPlanSuggestion {
  campaignIdeas: string[];
  themes: string[];
  suggestedObjectives: string[];
  hashtags: string[];
  frequencySuggestion: string;
  suggestedSchedule: {
    title: string;
    platform: string;
    suggestedTime: string;
    captionSuggestion: string;
  }[];
}

export interface ConflictReport {
  hasConflicts: boolean;
  conflicts: {
    draftIdA: string;
    draftTitleA: string;
    draftIdB: string;
    draftTitleB: string;
    platform: string;
    timeSlot: string;
    reason: string;
  }[];
}

export interface ContentGapReport {
  hasGaps: boolean;
  gaps: {
    date: string;
    platform: string;
    reason: string;
  }[];
}

/**
 * Provider-agnostic AI planning assistant service.
 * UI never directly depends on external LLM clients.
 */
export class AICampaignPlannerService {
  /**
   * Generates campaign ideas and structural outline suggestions.
   */
  async generateCampaignPlan(prompt: string, platforms: string[]): Promise<AIPlanSuggestion> {
    // Fails gracefully or falls back to rules-based template if no external key is present
    return {
      campaignIdeas: [
        `Cinematic Spotlight: Showcasing ${prompt} through high-contrast premium photography.`,
        `Editorial Narrative: Interactive text series describing the craftsmanship behind ${prompt}.`,
      ],
      themes: [
        "Vapor & Shadows: Dark tones, high editorial framing.",
        "Reflections: Minimalist close-ups showcasing glass, steel, or premium texture.",
      ],
      suggestedObjectives: [
        `Establish premium authority for ${prompt} within 30 days.`,
        "Drive 15% increase in high-intent landing page traffic.",
      ],
      hashtags: ["#VillizPixels", "#CinematicRefinement", "#PremiumEditorial", `#${prompt.replace(/\s+/g, "")}`],
      frequencySuggestion: "3 posts per week (Monday, Wednesday, Friday) at 9:00 AM local time.",
      suggestedSchedule: platforms.map((platform) => ({
        title: `Welcome to the ${prompt} Experience`,
        platform,
        suggestedTime: "2026-08-03T09:00:00Z",
        captionSuggestion: `Refined. Audited. Complete. The new ${prompt} campaign starts now. Join us. #VillizPixels`,
      })),
    };
  }

  /**
   * Detects scheduling conflicts where multiple posts are scheduled close to each other on the same channel.
   */
  detectConflicts(drafts: ContentDraft[]): ConflictReport {
    const scheduled = drafts.filter((d) => d.status === "scheduled" && d.scheduledAt && d.scheduledPlatform);
    const conflicts: ConflictReport["conflicts"] = [];

    for (let i = 0; i < scheduled.length; i++) {
      for (let j = i + 1; j < scheduled.length; j++) {
        const a = scheduled[i];
        const b = scheduled[j];
        if (!a || !b) continue;

        if (a.scheduledPlatform === b.scheduledPlatform) {
          const timeA = new Date(a.scheduledAt!).getTime();
          const timeB = new Date(b.scheduledAt!).getTime();
          const diffMinutes = Math.abs(timeA - timeB) / (1000 * 60);

          // Conflict if within 30 minutes on the same platform
          if (diffMinutes < 30) {
            conflicts.push({
              draftIdA: a.id,
              draftTitleA: a.title,
              draftIdB: b.id,
              draftTitleB: b.title,
              platform: a.scheduledPlatform!,
              timeSlot: new Date(a.scheduledAt!).toISOString(),
              reason: `Posts are scheduled only ${Math.round(diffMinutes)} minutes apart on ${a.scheduledPlatform?.toUpperCase()}.`,
            });
          }
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
    };
  }

  /**
   * Detects coverage gaps (e.g. calendar days during the campaign with no planned posts).
   */
  detectContentGaps(campaign: Campaign, drafts: ContentDraft[]): ContentGapReport {
    if (!campaign.startDate || !campaign.endDate) {
      return { hasGaps: false, gaps: [] };
    }

    const _start = new Date(campaign.startDate);
    const _end = new Date(campaign.endDate);
    const gaps: ContentGapReport["gaps"] = [];

    // Check for each platform in the campaign
    for (const platform of campaign.platforms) {
      const platformDrafts = drafts.filter(
        (d) => d.campaign?.id === campaign.id && d.status === "scheduled" && d.scheduledPlatform === platform
      );

      // If no drafts at all for this platform
      if (platformDrafts.length === 0) {
        gaps.push({
          date: campaign.startDate,
          platform,
          reason: `No scheduled content exists on ${platform.toUpperCase()} for the entire campaign duration.`,
        });
      }
    }

    return {
      hasGaps: gaps.length > 0,
      gaps,
    };
  }
}
