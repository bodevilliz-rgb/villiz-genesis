import { describe, expect, it } from "vitest";
import {
  buildVisibilityPlan,
  DISTRIBUTION_READINESS_THRESHOLD,
} from "@/core/application/use-cases/market-intelligence/visibility";

/**
 * Verification: Awo Audience Distribution Gate for Mervic Signatures content.
 *
 * Uses the real buildVisibilityPlan function with Mervic's campaign context
 * to confirm the distribution gate passes at the required threshold.
 * No Supabase, no Blotato API, no live publishing — pure deterministic function.
 */

const MERVIC_BRIEF =
  "Mervic Signatures is a UK wedding hair and makeup service delivering natural medium-skin glow looks.";

const MERVIC_TARGET_AUDIENCE =
  "Engaged couples, 25-40, seeking natural, medium-skin-tone-complementing " +
  "wedding hair and makeup with a clean luxury aesthetic.";

const MERVIC_MEMBRAIN_CONTEXT =
  "Brand: Mervic Signatures. " +
  "Location: Coventry, West Midlands, UK. " +
  "Service area: Warwickshire, Worcestershire. " +
  "Content pillar: Natural medium-skin glow wedding transformations.";

describe("Awo Audience Distribution Gate — Mervic Signatures", () => {
  it("generates a visibility plan with distributionGate=pass and score=100", () => {
    const visibilityPlan = buildVisibilityPlan({
      platform: "instagram",
      objectiveType: "enquiries",
      commercialIntent: "convert",
      targetAudience: MERVIC_TARGET_AUDIENCE,
      industry: "hair beauty", // maps to hair_beauty vertical
      mediaMimeTypes: ["image/jpeg"],
      selectedMarketPatternIds: ["pattern-1"],
      media: [{ mimeType: "image/jpeg", title: "Wedding portrait with natural medium-skin glow makeup" }],
      targetGeographies: ["Coventry"],
      serviceAreas: ["West Midlands"],
      conversionActions: ["booking"],
      platformStrategy:
        `Mervic Signatures delivers ${MERVIC_BRIEF} ` +
        "Use clean luxury aesthetic with natural medium-skin glow makeup artistry. " +
        "Close-up portrait framing prioritizes skin texture and color payoff. " +
        "Mervic Signatures distinctive colour palette: restrained burnt orange accent. " +
        `Context: ${MERVIC_MEMBRAIN_CONTEXT}`,
      hashtagStrategyRoles: ["local", "service", "brand", "occasion_topic"],
      contentPillar: "Natural medium-skin glow wedding transformations",
      goalRationale:
        "Driving enquiries for wedding hair and makeup services in Coventry and the West Midlands.",
    });

    // Core assertions: the gate must pass at 100/100
    expect(visibilityPlan.distributionGate).toBe("pass");
    expect(visibilityPlan.distributionReadinessScore).toBe(100);
    expect(visibilityPlan.distributionBlockers).toEqual([]);

    // Verify threshold constant matches the production gate
    expect(DISTRIBUTION_READINESS_THRESHOLD).toBe(95);

    // Verify locality resolution
    expect(visibilityPlan.targetLocalities).toEqual(["Coventry", "West Midlands"]);
    expect(visibilityPlan.discoveryRoles).toContain("local");
    expect(visibilityPlan.discoveryRoles).toContain("service");

    // Verify the plan includes a CTA strategy
    expect(visibilityPlan.ctaStrategy).toContain("booking");

    // Verify measurement plan exists
    expect(visibilityPlan.measurementPlan).toContain("enquiry");
  });

  it("blocks when locality is missing — demonstrates the gate is fail-closed", () => {
    const blockedPlan = buildVisibilityPlan({
      platform: "instagram",
      objectiveType: "enquiries",
      commercialIntent: "convert",
      targetAudience: MERVIC_TARGET_AUDIENCE,
      industry: "hair beauty",
      mediaMimeTypes: ["image/jpeg"],
      selectedMarketPatternIds: ["pattern-1"],
      media: [{ mimeType: "image/jpeg", title: "Wedding portrait" }],
      targetGeographies: [], // NO locality
      serviceAreas: [],
      conversionActions: ["booking"],
      platformStrategy: "Visual-first with clean luxury aesthetic.",
      hashtagStrategyRoles: ["local", "service"],
      contentPillar: "Natural medium-skin glow wedding transformations",
      goalRationale: "Driving enquiries.",
    });

    // Without locality, the gate must block
    expect(blockedPlan.distributionGate).toBe("blocked");
    expect(blockedPlan.distributionReadinessScore).toBe(80); // localityReady = 20 points lost
    expect(blockedPlan.distributionBlockers).toContain(
      "Configure at least one ACOR target geography or service locality."
    );
  });
});
