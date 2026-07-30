import { describe, expect, it } from "vitest";
import { computeOverallConfidence } from "@/core/application/use-cases/generation/confidence-engine";
import { resolveCampaignReadiness } from "@/core/application/use-cases/generation/campaign-resolver";
import { resolveKnowledgeCoverage } from "@/core/application/use-cases/generation/knowledge-resolver";
import { analyseDraft } from "@/core/application/use-cases/generation/draft-analyser";
import { computeMembrainReadiness } from "@/core/application/use-cases/membrain/readiness";
import type { CampaignContext, DraftAnalyserInput } from "@/core/domain/entities/generation";

const FULL_MEMBRAIN = computeMembrainReadiness([
  { categoryKey: "brand_description", status: "active" },
  { categoryKey: "audience", status: "active" },
  { categoryKey: "brand_voice", status: "active" },
  { categoryKey: "content_pillars", status: "active" },
  { categoryKey: "content_pillars", status: "active" },
  { categoryKey: "content_pillars", status: "active" },
  { categoryKey: "offering", status: "active" },
  { categoryKey: "guidelines", status: "active" },
]);
const EMPTY_MEMBRAIN = computeMembrainReadiness([]);

const CAMPAIGN: CampaignContext = {
  id: "campaign-1",
  name: "Spring promotion",
  objective: "Fill appointment slots",
  targetAudience: "Existing patients",
  primaryCTA: "Book your check-up",
  platforms: ["instagram"],
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  status: "active",
};

const GOOD_DRAFT: DraftAnalyserInput = {
  title: "Spring check-up reminder",
  body: `${"A".repeat(150)} Book your check-up today.`,
  contentType: "social_post",
  hasCategory: true,
  campaign: CAMPAIGN,
};

describe("computeOverallConfidence", () => {
  it("scores near 100 when knowledge, campaign and draft are all fully ready", () => {
    const knowledge = resolveKnowledgeCoverage(FULL_MEMBRAIN);
    const campaign = resolveCampaignReadiness(CAMPAIGN);
    const draft = analyseDraft(GOOD_DRAFT);

    const confidence = computeOverallConfidence(knowledge, campaign, draft);
    expect(confidence.score).toBe(100);
    expect(confidence.weaknesses).toHaveLength(0);
    expect(confidence.missingInformation).toHaveLength(0);
  });

  it("scores 0 when nothing is ready", () => {
    const knowledge = resolveKnowledgeCoverage(EMPTY_MEMBRAIN);
    const campaign = resolveCampaignReadiness({
      ...CAMPAIGN,
      objective: null,
      targetAudience: null,
      primaryCTA: null,
      platforms: [],
      startDate: null,
      endDate: null,
      status: "archived",
    });
    // campaign: null here (not the broken CampaignContext above) so
    // campaignAlignment is excluded as not-applicable rather than
    // incidentally passing against a still-valid campaign object.
    const draft = analyseDraft({ ...GOOD_DRAFT, title: "x", body: "TODO", hasCategory: false, campaign: null });

    const confidence = computeOverallConfidence(knowledge, campaign, draft);
    expect(confidence.score).toBe(0);
    expect(confidence.strengths).toHaveLength(0);
  });

  it("excludes campaign readiness from the weighting when no campaign is linked, rather than penalising it", () => {
    const knowledge = resolveKnowledgeCoverage(FULL_MEMBRAIN);
    const draft = analyseDraft({ ...GOOD_DRAFT, campaign: null });

    const withoutCampaign = computeOverallConfidence(knowledge, null, draft);
    expect(withoutCampaign.score).toBe(100);
    expect(withoutCampaign.reasoning.some((line) => line.includes("No campaign linked"))).toBe(true);
  });

  it("is deterministic: identical inputs always produce identical output", () => {
    const knowledge = resolveKnowledgeCoverage(FULL_MEMBRAIN);
    const campaign = resolveCampaignReadiness(CAMPAIGN);
    const draft = analyseDraft(GOOD_DRAFT);

    const a = computeOverallConfidence(knowledge, campaign, draft);
    const b = computeOverallConfidence(knowledge, campaign, draft);
    expect(a).toEqual(b);
  });
});
