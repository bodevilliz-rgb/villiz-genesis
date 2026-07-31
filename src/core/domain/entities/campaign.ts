export type CampaignStatus = "planning" | "active" | "completed" | "archived";

/**
 * Mirrors the database's `social_platform` enum (introduced in the 0004
 * guardrails migration for the still-unbuilt publishing queue) rather than
 * importing it from infrastructure — `core/domain` takes no dependency on
 * generated database types, the same reason MembrainStatus/ContentDraftStatus
 * are hand-declared here rather than imported. This records planning intent
 * ("which channels is this campaign for") only; it is not a publishing
 * integration and grants no platform access.
 */
export type CampaignPlatform =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "x"
  | "tiktok"
  | "youtube"
  | "pinterest"
  | "threads";

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  planning: "Planning",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, "neutral" | "positive" | "muted" | "accent"> = {
  planning: "neutral",
  active: "positive",
  completed: "accent",
  archived: "muted",
};

export const CAMPAIGN_PLATFORM_LABELS: Record<CampaignPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
};

export interface Campaign {
  id: string;
  organisationId: string;
  name: string;
  description: string | null;
  objective: string | null;
  targetAudience: string | null;
  primaryCTA: string | null;
  /** ISO date (`YYYY-MM-DD`), no time component — this is planning granularity, not a schedule. */
  startDate: string | null;
  endDate: string | null;
  status: CampaignStatus;
  platforms: CampaignPlatform[];
  successMetric: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string | null; email: string } | null;
  updatedBy: { id: string; fullName: string | null; email: string } | null;

  // Sprint 2 properties
  client: string | null;
  brand: string | null;
  campaignType: string | null;
  ownerId: string | null;
  teamMembers: string[];
  colorLabel: string | null;
  tags: string[];
  priority: string | null;
  notes: string | null;
  // Legacy JSON format retained for backward compatibility or migration script handling
  legacyAssets?: { name: string; url: string; mimeType?: string; sizeBytes?: number }[];
  assets?: { assetId: string; attachedBy: string | null; createdAt: string; asset?: import('./media').MediaAsset }[];
}

export interface CampaignCreatedEvent {
  eventId: string;
  occurredAt: string;
  campaignId: string;
  organisationId: string;
  name: string;
  actorId: string;
}

export interface CampaignCompletedEvent {
  eventId: string;
  occurredAt: string;
  campaignId: string;
  organisationId: string;
  actorId: string;
}

export interface CampaignOverview {
  campaign: Campaign;
  draftCounts: {
    draft: number;
    inReview: number;
    approved: number;
    scheduled: number;
    published: number;
    total: number;
  };
}

export interface CampaignListItem extends Campaign {
  draftCount: number;
}

/**
 * A simple visual timeline, not a scheduler: how far through its planned
 * dates a campaign is, as of `now`. Pure and deterministic so the UI never
 * has to reimplement this — no calendar, no time-of-day precision, nothing
 * beyond "elapsed fraction of the planned date range".
 */
export interface CampaignTimelineProgress {
  /** Null when either date is missing — there is nothing to visualise yet. */
  percentElapsed: number | null;
  hasStarted: boolean;
  hasEnded: boolean;
  totalDays: number | null;
  elapsedDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeCampaignTimelineProgress(
  startDate: string | null,
  endDate: string | null,
  now: Date = new Date(),
): CampaignTimelineProgress {
  if (!startDate || !endDate) {
    return { percentElapsed: null, hasStarted: false, hasEnded: false, totalDays: null, elapsedDays: null };
  }

  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const current = now.getTime();

  const totalDays = Math.max(Math.round((end - start) / DAY_MS), 0);
  const hasStarted = current >= start;
  const hasEnded = current > end;

  if (totalDays === 0) {
    return { percentElapsed: hasEnded ? 100 : 0, hasStarted, hasEnded, totalDays, elapsedDays: hasEnded ? 0 : 0 };
  }

  const elapsedDays = Math.min(Math.max(Math.round((current - start) / DAY_MS), 0), totalDays);
  const percentElapsed = Math.min(Math.max(Math.round((elapsedDays / totalDays) * 100), 0), 100);

  return { percentElapsed, hasStarted, hasEnded, totalDays, elapsedDays };
}
