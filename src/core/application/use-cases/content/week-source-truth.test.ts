import { describe, expect, it } from "vitest";
import type { ContentDraft } from "@/core/domain/entities/content";
import { composeWeekSourceTruth, prependWeekSourceTruth } from "./week-source-truth";

function draft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: "draft-1",
    organisationId: "org-1",
    title: "Week 1 — Your hair is unique",
    contentType: "social_post",
    summary: "Protective styling is not one-size-fits-all. Learn your hair needs and limits.",
    body: "",
    status: "draft",
    awoStatus: "ready_for_awo",
    version: 1,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    dueAt: null,
    reviewerIds: [],
    priority: "medium",
    reviewDeadline: null,
    hashtags: [],
    assets: [{
      assetId: "asset-1",
      attachedBy: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      asset: {
        id: "asset-1",
        organisationId: "org-1",
        storagePath: "campaign/week1.png",
        fileName: "Week1.png",
        mimeType: "image/png",
        sizeBytes: 123,
        width: 1080,
        height: 1350,
        uploadedBy: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        title: "Know your hair",
        thumbnailPath: null,
        category: null,
        description: "Your hair is unique. Protective styling should fit your hair needs, not the other way round.",
        altText: "Hairsential Monday artwork about understanding individual hair needs",
        tags: ["natural hair", "protective styling", "hair needs"],
        brand: "Mervic Signatures",
        duration: null,
        copyrightOwner: null,
        usageRights: null,
        expiresAt: null,
        isAiGenerated: false,
        isArchived: false,
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    }],
    ...overrides,
  };
}

describe("week source truth", () => {
  it("combines draft and attached artwork metadata into one authoritative weekly truth", () => {
    const truth = composeWeekSourceTruth(draft());
    expect(truth).toContain("Your hair is unique");
    expect(truth).toContain("Protective styling is not one-size-fits-all");
    expect(truth).toContain("understanding individual hair needs");
    expect(truth).toContain("natural hair, protective styling, hair needs");
  });

  it("puts Week Source Truth ahead of the broader generation brief", () => {
    const truth = composeWeekSourceTruth(draft());
    const enriched = prependWeekSourceTruth("Create an engaging Monday post for UK audiences.", truth);
    expect(enriched.indexOf("WEEK SOURCE TRUTH")).toBeLessThan(enriched.indexOf("GENERATION BRIEF"));
    expect(enriched).toContain("platform adaptation may change delivery, never subject");
  });
});
