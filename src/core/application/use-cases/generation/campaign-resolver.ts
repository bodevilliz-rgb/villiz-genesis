import type { CampaignContext, CampaignReadiness, CampaignReadinessCheck } from "@/core/domain/entities/generation";

/**
 * Phase 3 — Campaign Resolver. Pure and deterministic: six checks over a
 * campaign's own fields, no I/O. Takes the already-assembled CampaignContext
 * snapshot (a subset of Campaign with exactly the fields these checks need)
 * rather than the full Campaign entity — that avoids the orchestrator having
 * to fetch a campaign a second time when buildGenerationContext already has.
 */
const CHECKS: ReadonlyArray<{
  key: string;
  label: string;
  met: (campaign: CampaignContext) => boolean;
  warning: string;
  recommendation: string;
}> = [
  {
    key: "objective",
    label: "Objective is set",
    met: (c) => Boolean(c.objective),
    warning: "No objective set.",
    recommendation: "Set an objective so generated content has a clear goal to work toward.",
  },
  {
    key: "targetAudience",
    label: "Target audience is set",
    met: (c) => Boolean(c.targetAudience),
    warning: "No target audience set.",
    recommendation: "Describe the target audience so tone and messaging can be aimed correctly.",
  },
  {
    key: "primaryCTA",
    label: "Primary call to action is set",
    met: (c) => Boolean(c.primaryCTA),
    warning: "No primary call to action set.",
    recommendation: "Set a primary call to action — every piece of content should point somewhere.",
  },
  {
    key: "platforms",
    label: "At least one platform is selected",
    met: (c) => c.platforms.length > 0,
    warning: "No platforms selected.",
    recommendation: "Select at least one platform this campaign is planned for.",
  },
  {
    key: "dates",
    label: "Start and end dates are set",
    met: (c) => Boolean(c.startDate) && Boolean(c.endDate),
    warning: "Start or end date is missing.",
    recommendation: "Set a start and end date so the campaign's timeline is clear.",
  },
  {
    key: "status",
    label: "Campaign is not archived",
    met: (c) => c.status !== "archived",
    warning: "This campaign is archived.",
    recommendation: "Reopen the campaign before generating new content for it.",
  },
];

/**
 * Returns null when no campaign is linked — that's not a failure state
 * (campaign linkage is optional, see Sprint 3.2), just "not applicable".
 */
export function resolveCampaignReadiness(campaign: CampaignContext | null): CampaignReadiness | null {
  if (!campaign) return null;

  const checks: CampaignReadinessCheck[] = CHECKS.map(({ key, label, met }) => ({
    key,
    label,
    met: met(campaign),
  }));

  const failed = CHECKS.filter((check) => !check.met(campaign));
  const metCount = checks.length - failed.length;

  return {
    score: Math.round((metCount / checks.length) * 100),
    checks,
    warnings: failed.map((check) => check.warning),
    recommendations: failed.map((check) => check.recommendation),
  };
}
