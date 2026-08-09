/**
 * confirmButtonLabel — pure derivation of the Pre-Publish Review confirm
 * button's label from intent.mode alone (fix/scheduled-publishing-integrity).
 * Never hardcoded, never guessed — see pre-publish-dialog.tsx.
 */
import { describe, expect, it } from "vitest";
import { confirmButtonLabel } from "@/components/content/pre-publish-dialog";
import type { PublishingIntent } from "@/core/domain/entities/publishing";

const scheduledIntent: PublishingIntent = {
  mode: "scheduled",
  organisationId: "org-1",
  draftId: "draft-1",
  platform: "instagram",
  resolvedAccountId: "acc-1",
  scheduledForUtc: "2026-08-15T13:00:00.000Z",
  displayTimezone: "Europe/London",
  scheduledForLocalDisplay: "Aug 15, 2026, 2:00 PM",
};

const immediateIntent: PublishingIntent = {
  mode: "immediate",
  organisationId: "org-1",
  draftId: "draft-1",
  platform: "instagram",
  resolvedAccountId: "acc-1",
};

describe("confirmButtonLabel", () => {
  it("scheduled intent → 'Schedule Post'", () => {
    expect(confirmButtonLabel(scheduledIntent, { liveBlocked: false, submitting: false, score: 90 })).toBe("Schedule Post");
  });

  it("scheduled intent, submitting → 'Scheduling…'", () => {
    expect(confirmButtonLabel(scheduledIntent, { liveBlocked: false, submitting: true, score: 90 })).toBe("Scheduling…");
  });

  it("immediate intent, high score → 'Publish Now'", () => {
    expect(confirmButtonLabel(immediateIntent, { liveBlocked: false, submitting: false, score: 90 })).toBe("Publish Now");
  });

  it("immediate intent, low score → 'Publish Anyway'", () => {
    expect(confirmButtonLabel(immediateIntent, { liveBlocked: false, submitting: false, score: 40 })).toBe("Publish Anyway");
  });

  it("immediate intent, submitting → 'Publishing…'", () => {
    expect(confirmButtonLabel(immediateIntent, { liveBlocked: false, submitting: true, score: 90 })).toBe("Publishing…");
  });

  it("liveBlocked always wins regardless of intent mode", () => {
    expect(confirmButtonLabel(scheduledIntent, { liveBlocked: true, submitting: false, score: 90 })).toBe("Requirements not met");
    expect(confirmButtonLabel(immediateIntent, { liveBlocked: true, submitting: false, score: 90 })).toBe("Requirements not met");
  });

  it("no intent captured yet → a neutral label, never 'Publish Now' by default", () => {
    expect(confirmButtonLabel(null, { liveBlocked: false, submitting: false, score: undefined })).toBe("Review required");
  });
});
