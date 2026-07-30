import type {
  CampaignReadiness,
  DraftAnalysis,
  KnowledgeCoverage,
  OverallConfidence,
} from "@/core/domain/entities/generation";

/**
 * Phase 5 — Confidence Engine. A single weighted aggregate of the three
 * prior engines' scores. When no campaign is linked, its weight is
 * redistributed proportionally rather than counted as a failure — a
 * campaign is optional (Sprint 3.2), so its absence shouldn't tank
 * confidence the way a genuinely incomplete campaign would.
 */
const WEIGHTS_WITH_CAMPAIGN = { knowledge: 0.4, campaign: 0.25, draft: 0.35 };
const WEIGHTS_WITHOUT_CAMPAIGN = { knowledge: 0.55, draft: 0.45 };

export function computeOverallConfidence(
  knowledge: KnowledgeCoverage,
  campaign: CampaignReadiness | null,
  draft: DraftAnalysis,
): OverallConfidence {
  const score = campaign
    ? Math.round(
        knowledge.coveragePercent * WEIGHTS_WITH_CAMPAIGN.knowledge +
          campaign.score * WEIGHTS_WITH_CAMPAIGN.campaign +
          draft.readinessPercent * WEIGHTS_WITH_CAMPAIGN.draft,
      )
    : Math.round(
        knowledge.coveragePercent * WEIGHTS_WITHOUT_CAMPAIGN.knowledge +
          draft.readinessPercent * WEIGHTS_WITHOUT_CAMPAIGN.draft,
      );

  const reasoning: string[] = [
    `MemBrain knowledge coverage: ${knowledge.coveragePercent}% (weighted ${Math.round((campaign ? WEIGHTS_WITH_CAMPAIGN.knowledge : WEIGHTS_WITHOUT_CAMPAIGN.knowledge) * 100)}%).`,
    campaign
      ? `Campaign readiness: ${campaign.score}% (weighted ${Math.round(WEIGHTS_WITH_CAMPAIGN.campaign * 100)}%).`
      : "No campaign linked — campaign readiness excluded from this score rather than counted against it.",
    `Draft readiness: ${draft.readinessPercent}% (weighted ${Math.round((campaign ? WEIGHTS_WITH_CAMPAIGN.draft : WEIGHTS_WITHOUT_CAMPAIGN.draft) * 100)}%).`,
  ];

  const strengths: string[] = [
    ...knowledge.categories.filter((c) => c.state === "complete").map((c) => `${c.label} is covered in MemBrain.`),
    ...(campaign?.checks.filter((c) => c.met).map((c) => c.label) ?? []),
    ...draft.checks.filter((c) => c.applicable && c.passed).map((c) => c.label),
  ];

  const weaknesses: string[] = [
    ...knowledge.missingCategories.map((c) => `${c.label} is ${c.state} in MemBrain.`),
    ...(campaign?.warnings ?? []),
    ...draft.warnings,
  ];

  const missingInformation: string[] = [
    ...knowledge.missingCategories.map((c) => c.label),
    ...(campaign?.checks.filter((c) => !c.met).map((c) => c.label) ?? []),
    ...draft.checks.filter((c) => c.applicable && !c.passed).map((c) => c.label),
  ];

  return { score, reasoning, strengths, weaknesses, missingInformation };
}
