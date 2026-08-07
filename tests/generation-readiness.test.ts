import { describe, expect, it } from "vitest";
import { computePromptReadyReasons, resolveReadinessStatus } from "@/core/application/use-cases/generation";
import { computeOverallConfidence } from "@/core/application/use-cases/generation/confidence-engine";
import { resolveKnowledgeCoverage } from "@/core/application/use-cases/generation/knowledge-resolver";
import { analyseDraft } from "@/core/application/use-cases/generation/draft-analyser";
import { computeMembrainReadiness } from "@/core/application/use-cases/membrain/readiness";
import type { CampaignContext, DraftAnalyserInput } from "@/core/domain/entities/generation";

// ── Shared fixtures ─────────────────────────────────────────────────────────────

const FULL_MEMBRAIN_ENTRIES = [
  { categoryKey: "brand_description", status: "active" as const },
  { categoryKey: "audience", status: "active" as const },
  { categoryKey: "brand_voice", status: "active" as const },
  { categoryKey: "content_pillars", status: "active" as const },
  { categoryKey: "content_pillars", status: "active" as const },
  { categoryKey: "content_pillars", status: "active" as const },
  { categoryKey: "offering", status: "active" as const },
  { categoryKey: "guidelines", status: "active" as const },
];

const FULL_CAMPAIGN: CampaignContext = {
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

const GOOD_DRAFT_INPUT: DraftAnalyserInput = {
  title: "Luxury Wig Installation",
  // Body matches FULL_CAMPAIGN.primaryCTA ("Book your check-up") so callToAction
  // passes whether or not a campaign is linked.
  body: `${"A".repeat(150)} Book your check-up today.`,
  contentType: "social_post",
  hasCategory: true,
  campaign: null,
};

// ── 1–3: computePromptReadyReasons — Fix A ─────────────────────────────────────

describe("computePromptReadyReasons", () => {
  it("1 — brand description missing, body present → only brand description reason, not body", () => {
    const reasons = computePromptReadyReasons(false, true);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/Brand Description/i);
    expect(reasons[0]).not.toMatch(/draft body/i);
  });

  it("2 — brand description present, body missing → only saved-body reason, not brand description", () => {
    const reasons = computePromptReadyReasons(true, false);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/draft body/i);
    expect(reasons[0]).not.toMatch(/Brand Description/i);
  });

  it("3 — both missing → both reasons present", () => {
    const reasons = computePromptReadyReasons(false, false);

    expect(reasons).toHaveLength(2);
    expect(reasons.some((r) => /Brand Description/i.test(r))).toBe(true);
    expect(reasons.some((r) => /draft body/i.test(r))).toBe(true);
  });

  it("both present → no reasons", () => {
    const reasons = computePromptReadyReasons(true, true);
    expect(reasons).toHaveLength(0);
  });
});

// ── 4–5: content_pillars entryCount / requiredCount — Fix B data layer ─────────

describe("resolveKnowledgeCoverage — content_pillars counts", () => {
  it("4 — 2 active content_pillars entries → partial, entryCount=2, requiredCount=3", () => {
    const readiness = computeMembrainReadiness([
      { categoryKey: "content_pillars", status: "active" },
      { categoryKey: "content_pillars", status: "active" },
    ]);
    const coverage = resolveKnowledgeCoverage(readiness);
    const pillars = coverage.categories.find((c) => c.categoryKey === "content_pillars")!;

    expect(pillars.state).toBe("partial");
    expect(pillars.entryCount).toBe(2);
    expect(pillars.requiredCount).toBe(3);
    expect(coverage.missingCategories.some((c) => c.categoryKey === "content_pillars")).toBe(true);
  });

  it("5 — 3 active content_pillars entries → complete, entryCount=3, requiredCount=3", () => {
    const readiness = computeMembrainReadiness(FULL_MEMBRAIN_ENTRIES);
    const coverage = resolveKnowledgeCoverage(readiness);
    const pillars = coverage.categories.find((c) => c.categoryKey === "content_pillars")!;

    expect(pillars.state).toBe("complete");
    expect(pillars.entryCount).toBe(3);
    expect(pillars.requiredCount).toBe(3);
    expect(coverage.missingCategories.some((c) => c.categoryKey === "content_pillars")).toBe(false);
  });
});

// ── 6: draft-status entries excluded from readiness count ──────────────────────

describe("computeMembrainReadiness — active-only counting", () => {
  it("6 — draft and archived entries do not contribute to entryCount or met", () => {
    const readiness = computeMembrainReadiness([
      { categoryKey: "brand_description", status: "draft" },
      { categoryKey: "audience", status: "archived" },
      { categoryKey: "content_pillars", status: "draft" },
      { categoryKey: "content_pillars", status: "draft" },
      { categoryKey: "content_pillars", status: "draft" },
    ]);

    expect(readiness.metCount).toBe(0);
    expect(readiness.signals.find((s) => s.categoryKey === "brand_description")!.met).toBe(false);
    expect(readiness.signals.find((s) => s.categoryKey === "content_pillars")!.entryCount).toBe(0);
  });
});

// ── 7–8: confidence formulas ────────────────────────────────────────────────────

describe("computeOverallConfidence — formula correctness", () => {
  it("7 — without campaign: round(knowledge×0.55 + draft×0.45)", () => {
    const knowledge = resolveKnowledgeCoverage(
      computeMembrainReadiness([
        { categoryKey: "brand_description", status: "active" },
        { categoryKey: "audience", status: "active" },
        { categoryKey: "brand_voice", status: "active" },
        { categoryKey: "content_pillars", status: "active" },
        { categoryKey: "content_pillars", status: "active" },
        { categoryKey: "content_pillars", status: "active" },
        { categoryKey: "offering", status: "active" },
        // guidelines missing → 5/6 = 83%
      ]),
    );
    const draft = analyseDraft(GOOD_DRAFT_INPUT); // 100% — all checks pass

    const confidence = computeOverallConfidence(knowledge, null, draft);
    // round(83 * 0.55 + 100 * 0.45) = round(45.65 + 45) = round(90.65) = 91
    expect(confidence.score).toBe(91);
  });

  it("8 — with campaign: round(knowledge×0.40 + campaign×0.25 + draft×0.35)", () => {
    const knowledge = resolveKnowledgeCoverage(computeMembrainReadiness(FULL_MEMBRAIN_ENTRIES)); // 100%
    const campaign = { score: 100, checks: [], warnings: [], recommendations: [] };
    const draft = analyseDraft({ ...GOOD_DRAFT_INPUT, campaign: FULL_CAMPAIGN }); // 100%

    const confidence = computeOverallConfidence(knowledge, campaign, draft);
    // round(100*0.40 + 100*0.25 + 100*0.35) = 100
    expect(confidence.score).toBe(100);
  });
});

// ── 9–12: status gate — resolveReadinessStatus ─────────────────────────────────

describe("resolveReadinessStatus", () => {
  it("9 — confidence ≥ 80, promptReady false → needs_attention", () => {
    expect(resolveReadinessStatus(85, false)).toBe("needs_attention");
    expect(resolveReadinessStatus(80, false)).toBe("needs_attention");
  });

  it("10 — confidence < 80, promptReady true → needs_attention", () => {
    expect(resolveReadinessStatus(79, true)).toBe("needs_attention");
    expect(resolveReadinessStatus(0, true)).toBe("needs_attention");
  });

  it("11 — confidence ≥ 80, promptReady true → ready_for_awo", () => {
    expect(resolveReadinessStatus(80, true)).toBe("ready_for_awo");
    expect(resolveReadinessStatus(100, true)).toBe("ready_for_awo");
  });

  it("12 — no blocking reasons when both conditions are met (computePromptReadyReasons returns [])", () => {
    // The orchestrator does: blockingReasons: status === "ready_for_awo" ? [] : reasons
    // This test proves the precondition: when hasBrandDescription && hasDraftBody, no prompt reasons fire.
    const reasons = computePromptReadyReasons(true, true);
    expect(reasons).toHaveLength(0);
    expect(resolveReadinessStatus(80, true)).toBe("ready_for_awo");
  });
});
