import { describe, it, expect } from "vitest";
import { AICampaignPlannerService } from "@/core/application/use-cases/campaigns/planner";
import type { Campaign } from "@/core/domain/entities/campaign";
import type { ContentDraft } from "@/core/domain/entities/content";

describe("Sprint 2 — Campaign Orchestration & Content Calendar Tests", () => {
  const service = new AICampaignPlannerService();

  it("should generate a campaign suggestion plan correctly", async () => {
    const suggestion = await service.generateCampaignPlan("Spring launch", ["instagram", "x"]);
    expect(suggestion.campaignIdeas.length).toBeGreaterThan(0);
    expect(suggestion.hashtags).toContain("#VillizPixels");
    expect(suggestion.suggestedSchedule.length).toBe(2);
  });

  it("should detect scheduling conflicts on the same platform within 30 minutes", () => {
    const mockDrafts: ContentDraft[] = [
      {
        id: "draft-1",
        organisationId: "org-1",
        title: "Post A",
        contentType: "social_post",
        summary: null,
        body: "Hello",
        status: "scheduled",
        awoStatus: "not_requested",
        version: 1,
        category: null,
        campaign: null,
        assignedReviewer: null,
        lastReviewAction: null,
        lastReviewAt: null,
        scheduledAt: "2026-08-01T09:00:00Z",
        scheduledPlatform: "instagram",
        scheduledTimezone: "UTC",
        createdAt: "",
        updatedAt: "",
        createdBy: null,
        updatedBy: null,
        dueAt: null,
        reviewerIds: [],
      },
      {
        id: "draft-2",
        organisationId: "org-1",
        title: "Post B",
        contentType: "social_post",
        summary: null,
        body: "World",
        status: "scheduled",
        awoStatus: "not_requested",
        version: 1,
        category: null,
        campaign: null,
        assignedReviewer: null,
        lastReviewAction: null,
        lastReviewAt: null,
        scheduledAt: "2026-08-01T09:15:00Z",
        scheduledPlatform: "instagram",
        scheduledTimezone: "UTC",
        createdAt: "",
        updatedAt: "",
        createdBy: null,
        updatedBy: null,
        dueAt: null,
        reviewerIds: [],
      },
    ];

    const report = service.detectConflicts(mockDrafts);
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts[0]!.reason).toContain("scheduled only 15 minutes apart");
  });

  it("should detect content gaps for planned campaign platforms", () => {
    const mockCampaign: Campaign = {
      id: "camp-1",
      organisationId: "org-1",
      name: "Launch",
      description: null,
      objective: null,
      targetAudience: null,
      primaryCTA: null,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      status: "active",
      platforms: ["instagram", "x"],
      successMetric: null,
      createdAt: "",
      updatedAt: "",
      createdBy: null,
      updatedBy: null,
      client: null,
      brand: null,
      campaignType: null,
      ownerId: null,
      teamMembers: [],
      colorLabel: null,
      tags: [],
      priority: null,
      notes: null,
      assets: [],
    };

    // No drafts scheduled for Twitter/X
    const mockDrafts: ContentDraft[] = [
      {
        id: "draft-1",
        organisationId: "org-1",
        title: "Post A",
        contentType: "social_post",
        summary: null,
        body: "Hello",
        status: "scheduled",
        awoStatus: "not_requested",
        version: 1,
        category: null,
        campaign: { id: "camp-1", name: "Launch" },
        assignedReviewer: null,
        lastReviewAction: null,
        lastReviewAt: null,
        scheduledAt: "2026-08-02T09:00:00Z",
        scheduledPlatform: "instagram",
        scheduledTimezone: "UTC",
        createdAt: "",
        updatedAt: "",
        createdBy: null,
        updatedBy: null,
        dueAt: null,
        reviewerIds: [],
      },
    ];

    const report = service.detectContentGaps(mockCampaign, mockDrafts);
    expect(report.hasGaps).toBe(true);
    expect(report.gaps[0]!.platform).toBe("x");
  });
});
