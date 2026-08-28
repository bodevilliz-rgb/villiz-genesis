import { describe, expect, it } from "vitest";
import { buildIntentOpportunities, normaliseIntentService, type IntentSignal } from "@/core/domain/entities/intent";

function signal(overrides: Partial<IntentSignal> = {}): IntentSignal {
  return {
    id: crypto.randomUUID(),
    organisationId: "org-a",
    serviceKey: "knotless-braids",
    serviceLabel: "Knotless braids",
    locality: "Coventry",
    desiredTimeframe: "Within 14 days",
    source: "phone",
    stage: "enquiry",
    consentStatus: "not_required",
    occurredAt: "2026-08-28T09:00:00.000Z",
    createdBy: "staff-a",
    createdAt: "2026-08-28T09:00:00.000Z",
    ...overrides,
  };
}

describe("Intent-to-Opportunity Engine", () => {
  it("normalises reusable client service labels without client-specific code", () => {
    expect(normaliseIntentService("  Bridal Hair & Makeup  ")).toBe("bridal-hair-makeup");
  });

  it("aggregates the same service and locality into a priority opportunity", () => {
    const signals = [
      signal({ id: "a", source: "phone", stage: "enquiry" }),
      signal({ id: "b", source: "direct_message", stage: "quote_requested" }),
      signal({ id: "c", source: "website", stage: "booking_started" }),
      signal({ id: "d", source: "booking", stage: "booked" }),
    ];
    const [opportunity] = buildIntentOpportunities(signals, new Date("2026-08-28T10:00:00.000Z"));
    expect(opportunity.signalCount).toBe(4);
    expect(opportunity.intentOpportunityScore).toBe(90);
    expect(opportunity.priority).toBe("priority");
    expect(opportunity.evidenceSignalIds).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps organisations isolated by requiring callers to supply one organisation's signals", () => {
    const [opportunity] = buildIntentOpportunities([signal({ organisationId: "org-b", locality: null })], new Date("2026-08-28T10:00:00.000Z"));
    expect(opportunity.signalCount).toBe(1);
    expect(opportunity.priority).toBe("observe");
    expect(opportunity.rationale).toContain("No locality recorded");
  });

  it("does not combine different localities into one targeting cluster", () => {
    const opportunities = buildIntentOpportunities([
      signal({ id: "a", locality: "Coventry" }),
      signal({ id: "b", locality: "Birmingham" }),
    ], new Date("2026-08-28T10:00:00.000Z"));
    expect(opportunities).toHaveLength(2);
  });
});
