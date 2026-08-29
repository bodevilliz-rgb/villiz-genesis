import { describe, expect, it } from "vitest";
import { filterUnsupportedOccasionHashtags, growthOutputViolations } from "@/core/application/use-cases/market-intelligence/growth-output-guard";

const neutralEvidence = "A stylised studio portrait with directional light and a vintage television prop.";

describe("AGIE final output guard — client neutral", () => {
  it.each([
    "At Northstar Studio, we bring creative direction to every shoot.",
    "We build sessions around ideas that reflect your individuality.",
    "Our process guides every client from concept to final image.",
  ])("prevents asset outcomes becoming universal process claims: %s", (caption) => {
    expect(growthOutputViolations({ caption, evidence: neutralEvidence, conversionActions: ["whatsapp_enquiry"] })).toContain("The caption turns asset evidence into a universal or established client-process claim.");
  });

  it.each(["birthday", "wedding", "anniversary", "graduation", "milestone", "event", "personal brand"])("prevents unproven %s language from entering the caption", (term) => {
    expect(growthOutputViolations({ caption: `A distinctive ${term} portrait.`, evidence: neutralEvidence, conversionActions: ["contact_enquiry"] }).some((violation) => violation.includes(term))).toBe(true);
  });

  it("does not treat a service catalogue as current-asset evidence", () => {
    const serviceCatalogue = "The business sells weddings, birthdays, events and personal-brand photography.";
    expect(growthOutputViolations({ caption: "This wedding portrait stands out.", evidence: neutralEvidence, conversionActions: ["email_enquiry"] })).toHaveLength(1);
    expect(serviceCatalogue).not.toBe(neutralEvidence);
  });

  it("removes unsupported occasion hashtags while preserving grounded discovery", () => {
    expect(filterUnsupportedOccasionHashtags(["#NorthstarStudio", "#EditorialPortrait", "#MilestonePortrait", "#WeddingPhoto"], neutralEvidence)).toEqual(["#NorthstarStudio", "#EditorialPortrait"]);
  });

  it.each(["Book your shoot", "Reserve your session", "Secure your session", "Purchase now"])("does not escalate enquiry to booking: %s", (caption) => {
    expect(growthOutputViolations({ caption, evidence: neutralEvidence, conversionActions: ["whatsapp_enquiry"] }).some((violation) => violation.includes("enquiry-only"))).toBe(true);
  });

  it("allows an enquiry-stage CTA", () => {
    expect(growthOutputViolations({ caption: "Message us on WhatsApp to discuss your portrait idea.", evidence: neutralEvidence, conversionActions: ["whatsapp_enquiry"] })).toEqual([]);
  });

  it.each(["Ready for a better result?", "Looking for something different?", "Capture your story today.", "Create memories that last.", "Bring your vision to life."])("rejects a generic promotional opening: %s", (caption) => {
    expect(growthOutputViolations({ caption, evidence: neutralEvidence, conversionActions: ["contact_enquiry"] }).some((violation) => violation.includes("generic promotional hook"))).toBe(true);
  });

  it.each(["Bring your creative vision into focus.", "Every detail is thoughtfully considered.", "Where creativity meets excellence."])("rejects generic agency language: %s", (caption) => {
    expect(growthOutputViolations({ caption, evidence: neutralEvidence, conversionActions: ["contact_enquiry"] }).some((violation) => violation.includes("cliché"))).toBe(true);
  });

  it("rejects an organisation-first opening but accepts a specific audience-first difference", () => {
    expect(growthOutputViolations({ caption: "We create bold work for ambitious brands.", evidence: neutralEvidence, conversionActions: ["contact_enquiry"] }).some((violation) => violation.includes("organisation the hero"))).toBe(true);
    expect(growthOutputViolations({ caption: "Your product should be understood before it is compared. Contact us to discuss the message.", evidence: neutralEvidence, conversionActions: ["contact_enquiry"] })).toEqual([]);
  });
});
