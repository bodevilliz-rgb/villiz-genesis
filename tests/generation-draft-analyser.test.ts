import { describe, expect, it } from "vitest";
import { analyseDraft } from "@/core/application/use-cases/generation/draft-analyser";
import type { CampaignContext, DraftAnalyserInput } from "@/core/domain/entities/generation";

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

const LONG_BODY = `${"A".repeat(150)} Book your check-up today.`;

function input(overrides: Partial<DraftAnalyserInput> = {}): DraftAnalyserInput {
  return {
    title: "Spring check-up reminder",
    body: LONG_BODY,
    contentType: "social_post",
    hasCategory: true,
    campaign: CAMPAIGN,
    ...overrides,
  };
}

describe("analyseDraft", () => {
  it("never rewrites or alters the input — it only reports on it", () => {
    const original = input();
    const before = { ...original };
    analyseDraft(original);
    expect(original).toEqual(before);
  });

  it("passes every check for a substantial, complete, on-brand draft", () => {
    const analysis = analyseDraft(input());
    expect(analysis.readinessPercent).toBe(100);
    expect(analysis.warnings).toHaveLength(0);
  });

  it("flags a body that is too short", () => {
    const analysis = analyseDraft(input({ body: "Too short" }));
    expect(analysis.checks.find((c) => c.key === "length")?.passed).toBe(false);
  });

  it("flags a title that is too short to be descriptive", () => {
    const analysis = analyseDraft(input({ title: "Post" }));
    expect(analysis.checks.find((c) => c.key === "title")?.passed).toBe(false);
  });

  it("flags an unfinished placeholder left in the body", () => {
    const analysis = analyseDraft(input({ body: `${LONG_BODY} TODO: add pricing.` }));
    expect(analysis.checks.find((c) => c.key === "structure")?.passed).toBe(false);
  });

  it("passes the call-to-action check when the campaign's own CTA text appears in the body", () => {
    const analysis = analyseDraft(input({ body: "Come see us. Book your check-up whenever suits." }));
    expect(analysis.checks.find((c) => c.key === "callToAction")?.passed).toBe(true);
  });

  it("fails the call-to-action check when neither the campaign CTA nor a generic keyword appears", () => {
    const analysis = analyseDraft(
      input({ body: "A".repeat(150), campaign: { ...CAMPAIGN, primaryCTA: "Reserve your spot" } }),
    );
    expect(analysis.checks.find((c) => c.key === "callToAction")?.passed).toBe(false);
  });

  it("marks campaign alignment as not applicable when no campaign is linked", () => {
    const analysis = analyseDraft(input({ campaign: null }));
    const check = analysis.checks.find((c) => c.key === "campaignAlignment");
    expect(check?.applicable).toBe(false);
  });

  it("treats email as platform-agnostic — always aligned regardless of campaign", () => {
    const analysis = analyseDraft(input({ contentType: "email", campaign: { ...CAMPAIGN, platforms: [] } }));
    expect(analysis.checks.find((c) => c.key === "campaignAlignment")?.passed).toBe(true);
  });

  it("fails campaign alignment when a non-email draft's campaign has no platforms selected", () => {
    const analysis = analyseDraft(input({ campaign: { ...CAMPAIGN, platforms: [] } }));
    expect(analysis.checks.find((c) => c.key === "campaignAlignment")?.passed).toBe(false);
  });

  it("flags a missing content pillar as a brand-alignment failure", () => {
    const analysis = analyseDraft(input({ hasCategory: false }));
    expect(analysis.checks.find((c) => c.key === "brandAlignment")?.passed).toBe(false);
  });

  it("excludes non-applicable checks from the readiness percentage", () => {
    const analysis = analyseDraft(input({ campaign: null }));
    const applicableChecks = analysis.checks.filter((c) => c.applicable);
    expect(applicableChecks.every((c) => c.passed)).toBe(true);
    expect(analysis.readinessPercent).toBe(100);
  });
});
