import { describe, expect, it } from "vitest";
import {
  buildAwoInsights,
  buildContentPipeline,
  buildMyWork,
  buildReviewMetricsBase,
  computeAverageTurnaroundMinutes,
  isSameUtcDay,
  mergeActivity,
} from "@/core/application/use-cases/dashboard";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { CampaignListItem } from "@/core/domain/entities/campaign";
import type { CampaignReadiness } from "@/core/domain/entities/generation";
import type {
  ContentPipelineStage,
  ContentPipelineStageKey,
  ContentPipelineSummary,
  DashboardActivityItem,
} from "@/core/domain/entities/dashboard";
import type { Actor } from "@/core/domain/entities/identity";

const ACTOR: Actor = {
  id: "actor-1",
  email: "actor@villiz.com",
  fullName: "Actor One",
  avatarUrl: null,
  jobTitle: null,
  role: "member",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  isPlatformAdmin: false,
};

function draft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: "draft-1",
    organisationId: "org-1",
    title: "A draft",
    contentType: "social_post",
    summary: null,
    body: "Body",
    status: "draft",
    awoStatus: "not_requested",
    version: 1,
    category: null,
    campaign: null,
    assignedReviewer: null,
    lastReviewAction: null,
    lastReviewAt: null,
    scheduledAt: null,
    scheduledPlatform: null,
    scheduledTimezone: null,
    dueAt: null,
    reviewerIds: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    createdBy: { id: "actor-1", fullName: "Actor One", email: "actor@villiz.com" },
    updatedBy: { id: "actor-1", fullName: "Actor One", email: "actor@villiz.com" },
    priority: "medium",
    reviewDeadline: null,
    ...overrides,
  };
}

function campaign(overrides: Partial<CampaignListItem> = {}): CampaignListItem {
  return {
    id: "campaign-1",
    organisationId: "org-1",
    name: "Spring promotion",
    description: null,
    objective: null,
    targetAudience: null,
    primaryCTA: null,
    startDate: null,
    endDate: null,
    status: "active",
    platforms: [],
    successMetric: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    createdBy: null,
    updatedBy: null,
    draftCount: 0,
    client: null,
    brand: null,
    campaignType: null,
    ownerId: null,
    teamMembers: [],
    colorLabel: null,
    tags: [],
    priority: null,
    notes: null,
    ...overrides,
  };
}

function activity(overrides: Partial<DashboardActivityItem> = {}): DashboardActivityItem {
  return {
    id: "activity-1",
    kind: "content",
    organisationId: "org-1",
    organisationName: "Acme",
    entityId: "draft-1",
    entityTitle: "A draft",
    action: "created",
    actor: { id: "actor-1", fullName: "Actor One", email: "actor@villiz.com" },
    occurredAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function stagesByKey(pipeline: ContentPipelineSummary): Record<ContentPipelineStageKey, ContentPipelineStage> {
  return Object.fromEntries(pipeline.stages.map((s) => [s.key, s])) as Record<
    ContentPipelineStageKey,
    ContentPipelineStage
  >;
}

describe("buildContentPipeline", () => {
  it("buckets drafts by real status and by the orthogonal awoStatus flag", () => {
    const drafts = [
      draft({ id: "1", status: "draft", awoStatus: "ready_for_awo" }),
      draft({ id: "2", status: "needs_review" }),
      draft({ id: "3", status: "approved" }),
      draft({ id: "4", status: "approved" }),
    ];

    const pipeline = buildContentPipeline(drafts);
    const byKey = stagesByKey(pipeline);

    expect(byKey.draft.count).toBe(1);
    expect(byKey.needsReview.count).toBe(1);
    expect(byKey.approved.count).toBe(2);
    expect(byKey.readyForAwo.count).toBe(1);
    expect(pipeline.totalDrafts).toBe(4);
  });

  it("always renders readyToPublish and published as untracked zero stages", () => {
    const pipeline = buildContentPipeline([draft({ status: "approved" })]);
    const byKey = stagesByKey(pipeline);

    expect(byKey.readyToPublish).toEqual({ key: "readyToPublish", label: "Ready to publish", count: 0, isTracked: false });
    expect(byKey.published).toEqual({ key: "published", label: "Published", count: 0, isTracked: false });
  });

  it("counts a draft that is both Draft status and Ready for Awo in both buckets, never as a single sequential stage", () => {
    const pipeline = buildContentPipeline([draft({ status: "draft", awoStatus: "ready_for_awo" })]);
    const byKey = stagesByKey(pipeline);

    expect(byKey.draft.count).toBe(1);
    expect(byKey.readyForAwo.count).toBe(1);
  });
});

describe("mergeActivity", () => {
  it("merges multiple sources and sorts by recency, most recent first", () => {
    const merged = mergeActivity(
      [
        [activity({ id: "old", occurredAt: "2026-01-01T00:00:00Z" })],
        [activity({ id: "new", occurredAt: "2026-07-01T00:00:00Z" })],
      ],
      10,
    );

    expect(merged.map((a) => a.id)).toEqual(["new", "old"]);
  });

  it("truncates to the requested limit", () => {
    const merged = mergeActivity([[activity({ id: "a" }), activity({ id: "b" }), activity({ id: "c" })]], 2);
    expect(merged).toHaveLength(2);
  });
});

describe("buildMyWork", () => {
  it("only includes reviews the actor can approve, based on their role in that organisation", () => {
    const drafts = [
      draft({ id: "1", organisationId: "org-1", status: "needs_review" }),
      draft({ id: "2", organisationId: "org-2", status: "needs_review" }),
    ];

    const myWork = buildMyWork({
      actor: ACTOR,
      drafts,
      campaigns: [],
      organisationNames: new Map([
        ["org-1", "Acme"],
        ["org-2", "Beta"],
      ]),
      viewerRoles: new Map([
        ["org-1", "reviewer"],
        ["org-2", "contributor"],
      ]),
      activity: [],
    });

    expect(myWork.reviewsWaiting.map((r) => r.draftId)).toEqual(["1"]);
  });

  it("lists assigned campaigns most-recently-updated first, resolving the organisation name from the lookup map", () => {
    const campaigns = [
      campaign({ id: "older", updatedAt: "2026-01-01T00:00:00Z" }),
      campaign({ id: "newer", updatedAt: "2026-07-01T00:00:00Z" }),
    ];

    const myWork = buildMyWork({
      actor: ACTOR,
      drafts: [],
      campaigns,
      organisationNames: new Map([["org-1", "Acme"]]),
      viewerRoles: new Map(),
      activity: [],
    });

    expect(myWork.assignedCampaigns.map((c) => c.campaignId)).toEqual(["newer", "older"]);
    expect(myWork.assignedCampaigns[0]?.organisationName).toBe("Acme");
  });

  it("surfaces drafts the actor created or last updated as their recent drafts", () => {
    const drafts = [
      draft({ id: "mine", createdBy: { id: "actor-1", fullName: null, email: "actor@villiz.com" } }),
      draft({ id: "not-mine", createdBy: { id: "someone-else", fullName: null, email: "x@villiz.com" }, updatedBy: { id: "someone-else", fullName: null, email: "x@villiz.com" } }),
    ];

    const myWork = buildMyWork({
      actor: ACTOR,
      drafts,
      campaigns: [],
      organisationNames: new Map(),
      viewerRoles: new Map(),
      activity: [],
    });

    expect(myWork.recentDrafts.map((d) => d.draftId)).toEqual(["mine"]);
  });

  it("filters recent activity down to the actor's own actions", () => {
    const myWork = buildMyWork({
      actor: ACTOR,
      drafts: [],
      campaigns: [],
      organisationNames: new Map(),
      viewerRoles: new Map(),
      activity: [
        activity({ id: "mine", actor: { id: "actor-1", fullName: null, email: "actor@villiz.com" } }),
        activity({ id: "theirs", actor: { id: "someone-else", fullName: null, email: "x@villiz.com" } }),
      ],
    });

    expect(myWork.recentActivity.map((a) => a.id)).toEqual(["mine"]);
  });
});

describe("buildAwoInsights", () => {
  const READY: CampaignReadiness = { score: 100, checks: [], warnings: [], recommendations: [] };
  const NOT_READY: CampaignReadiness = {
    score: 40,
    checks: [],
    warnings: ["No objective set."],
    recommendations: ["Add an objective."],
  };

  it("does not surface an insight for a fully-covered organisation or a fully-ready campaign", () => {
    const insights = buildAwoInsights({
      organisationNames: new Map([["org-1", "Acme"]]),
      knowledgeCoverage: new Map([["org-1", 100]]),
      activeCampaignReadiness: [{ organisationId: "org-1", name: "Spring", readiness: READY }],
    });

    expect(insights).toHaveLength(0);
  });

  it("flags low MemBrain coverage as attention when under 50%, info otherwise", () => {
    const insights = buildAwoInsights({
      organisationNames: new Map([["org-1", "Acme"]]),
      knowledgeCoverage: new Map([["org-1", 33]]),
      activeCampaignReadiness: [],
    });

    expect(insights[0]?.severity).toBe("attention");
    expect(insights[0]?.organisationId).toBe("org-1");
  });

  it("surfaces a campaign's top warning when its readiness is below the threshold", () => {
    const insights = buildAwoInsights({
      organisationNames: new Map([["org-1", "Acme"]]),
      knowledgeCoverage: new Map(),
      activeCampaignReadiness: [{ organisationId: "org-1", name: "Spring", readiness: NOT_READY }],
    });

    expect(insights[0]?.message).toContain("No objective set.");
  });

  it("never fabricates an insight for a campaign with no readiness computed", () => {
    const insights = buildAwoInsights({
      organisationNames: new Map(),
      knowledgeCoverage: new Map(),
      activeCampaignReadiness: [{ organisationId: "org-1", name: "Spring", readiness: null }],
    });

    expect(insights).toHaveLength(0);
  });
});

describe("isSameUtcDay", () => {
  it("matches two timestamps on the same UTC calendar day", () => {
    expect(isSameUtcDay("2026-07-30T23:59:00Z", new Date("2026-07-30T00:00:00Z"))).toBe(true);
  });

  it("does not match timestamps on different UTC calendar days", () => {
    expect(isSameUtcDay("2026-07-29T23:59:00Z", new Date("2026-07-30T00:00:00Z"))).toBe(false);
  });
});

describe("buildReviewMetricsBase", () => {
  it("counts needs_review drafts with no assigned reviewer as waiting for assignment", () => {
    const drafts = [
      draft({ id: "1", status: "needs_review", assignedReviewer: null }),
      draft({ id: "2", status: "needs_review", assignedReviewer: { id: "someone", fullName: null, email: "x@villiz.com" } }),
    ];
    const metrics = buildReviewMetricsBase(drafts, "actor-1", new Date("2026-07-30T00:00:00Z"));
    expect(metrics.waitingForAssignment).toBe(1);
  });

  it("counts needs_review drafts assigned to the current actor", () => {
    const drafts = [draft({ status: "needs_review", assignedReviewer: { id: "actor-1", fullName: null, email: "actor@villiz.com" } })];
    const metrics = buildReviewMetricsBase(drafts, "actor-1", new Date("2026-07-30T00:00:00Z"));
    expect(metrics.assignedToMe).toBe(1);
  });

  it("counts drafts back in draft status because changes were requested, not newly-created drafts", () => {
    const drafts = [
      draft({ id: "returned", status: "draft", lastReviewAction: "changes_requested" }),
      draft({ id: "new", status: "draft", lastReviewAction: null }),
    ];
    const metrics = buildReviewMetricsBase(drafts, "actor-1", new Date("2026-07-30T00:00:00Z"));
    expect(metrics.returnedForChanges).toBe(1);
  });

  it("only counts approvals whose lastReviewAt falls on the reference UTC day", () => {
    const drafts = [
      draft({ id: "today", status: "approved", lastReviewAction: "approved", lastReviewAt: "2026-07-30T10:00:00Z" }),
      draft({ id: "yesterday", status: "approved", lastReviewAction: "approved", lastReviewAt: "2026-07-29T10:00:00Z" }),
    ];
    const metrics = buildReviewMetricsBase(drafts, "actor-1", new Date("2026-07-30T00:00:00Z"));
    expect(metrics.approvedTodayDrafts.map((d) => d.id)).toEqual(["today"]);
  });
});

describe("computeAverageTurnaroundMinutes", () => {
  it("returns null when nothing was approved today, rather than 0", () => {
    expect(computeAverageTurnaroundMinutes([], new Map())).toBeNull();
  });

  it("averages the time between last submission and approval, in minutes", () => {
    const drafts = [
      draft({ id: "1", lastReviewAt: "2026-07-30T10:30:00Z" }),
      draft({ id: "2", lastReviewAt: "2026-07-30T11:00:00Z" }),
    ];
    const submissions = new Map([
      ["1", "2026-07-30T10:00:00Z"], // 30 minutes
      ["2", "2026-07-30T10:00:00Z"], // 60 minutes
    ]);
    expect(computeAverageTurnaroundMinutes(drafts, submissions)).toBe(45);
  });

  it("ignores a draft with no matching submission event rather than treating it as zero", () => {
    const drafts = [draft({ id: "1", lastReviewAt: "2026-07-30T10:30:00Z" })];
    expect(computeAverageTurnaroundMinutes(drafts, new Map())).toBeNull();
  });
});
