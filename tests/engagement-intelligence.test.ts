import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateEngagementRecommendation, getEngagementLearningOverview } from "@/core/application/use-cases/engagement";
import type { AIProviderPort } from "@/core/application/ports/ai-provider-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { EngagementRecommendationWriteModel } from "@/core/domain/entities/engagement";
import type { Actor } from "@/core/domain/entities/identity";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const DRAFT_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const ENTRY_ID = "00000000-0000-4000-8000-000000000004";

const actor: Actor = {
  id: ACTOR_ID,
  email: "strategist@villiz.com",
  fullName: "Strategist",
  avatarUrl: null,
  jobTitle: null,
  role: "member",
  isActive: true,
  isPlatformAdmin: false,
  createdAt: "2026-08-01T00:00:00Z",
};

const draft: ContentDraft = {
  id: DRAFT_ID,
  organisationId: ORG_ID,
  title: "Portrait booking campaign",
  contentType: "social_post",
  summary: null,
  body: "Your next chapter deserves to be photographed. Book your portrait session.",
  hashtags: [],
  status: "draft",
  awoStatus: "ready_for_awo",
  version: 3,
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
  priority: "medium",
  reviewDeadline: null,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-10T00:00:00Z",
  createdBy: null,
  updatedBy: null,
};

function dependencies(options: { role?: "lead" | "contributor" | "reviewer"; withContext?: boolean } = {}) {
  const role = options.role ?? "contributor";
  const withContext = options.withContext ?? true;
  let persisted: EngagementRecommendationWriteModel | null = null;

  const organisations = {
    viewerRole: vi.fn(async () => role),
    findById: vi.fn(async () => ({
      id: ORG_ID,
      name: "Villiz Pixels",
      industry: "Photography",
      websiteUrl: null,
    })),
  } as unknown as OrganisationRepository;

  const content = {
    findDraft: vi.fn(async () => draft),
  } as unknown as ContentRepository;

  const campaigns = {
    findCampaign: vi.fn(async () => null),
  } as unknown as CampaignRepository;

  const membrain = {
    retrieveContext: vi.fn(async () =>
      withContext
        ? [
            {
              id: ENTRY_ID,
              title: "Brand voice",
              summary: null,
              body: "Warm, confident and human. Invite people to book without pressure.",
              importance: 5,
              categoryKey: "brand_voice",
              categoryLabel: "Brand voice",
              version: 2,
              updatedAt: "2026-08-09T00:00:00Z",
            },
          ]
        : [],
    ),
    markRetrieved: vi.fn(async () => undefined),
    recordAiUsage: vi.fn(async () => undefined),
  } as unknown as MembrainRepository;

  const ai: AIProviderPort = {
    generateText: vi.fn(async () => "unused"),
    generateObject: vi.fn(async () => ({
      recommendedCaption: "A portrait that feels like you. Book your session today.",
      alternativeCaptions: ["Alternative one", "Alternative one"],
      hook: "A portrait that feels like you.",
      cta: "Book your session today.",
      hashtags: {
        brand: ["#VillizPixels"],
        local: ["#CoventryPhotographer"],
        service: ["#PortraitPhotography", "#VillizPixels"],
        audience: ["#CoventryCreatives"],
      },
      rationale: "The caption leads with identity and closes with a direct booking action.",
      predictedStrengths: ["Clear opening hook", "Direct CTA"],
      limitations: [],
      creativeGuidance: {
        mediaBasis: "none",
        visualHook: "Lead with the portrait.",
        formatRecommendation: "Use a portrait carousel.",
        shareTrigger: "Invite someone planning a portrait.",
        saveTrigger: "Save the preparation tips.",
        accessibilityNote: "Add descriptive alt text.",
      },
      confidence: 96,
    })) as AIProviderPort["generateObject"],
  };

  const engagement = {
    create: vi.fn(async (input: EngagementRecommendationWriteModel) => {
      persisted = input;
      return {
        id: "00000000-0000-4000-8000-000000000005",
        ...input,
        createdAt: "2026-08-10T12:00:00Z",
      };
    }),
    findLatest: vi.fn(async () => null),
  } as EngagementRepository;

  const blotatoAccounts = {
    findActiveForOrganisationAndPlatform: vi.fn(async () => [{ id: "account-1" }]),
  } as unknown as BlotatoAccountRepository;

  return {
    deps: { actor, organisations, content, campaigns, membrain, ai, engagement, blotatoAccounts },
    ai,
    getPersisted: () => persisted,
  };
}

describe("AWO Engagement Intelligence", () => {
  it("creates an evidence-linked, immutable recommendation for the saved draft version", async () => {
    const fixture = dependencies();
    const recommendation = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "instagram",
      objective: "Increase qualified booking enquiries",
    });

    expect(recommendation.draftVersion).toBe(3);
    expect(recommendation.dataBasis).toBe("brand_only");
    expect(recommendation.evidence).toEqual([
      expect.objectContaining({ sourceId: ENTRY_ID, categoryKey: "brand_voice", version: 2 }),
    ]);
    expect(fixture.getPersisted()).toEqual(expect.objectContaining({ createdBy: ACTOR_ID }));
  });

  it("caps brand-only confidence and adds the non-guarantee limitation deterministically", async () => {
    const fixture = dependencies();
    const recommendation = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "instagram",
    });

    expect(recommendation.confidence).toBe(70);
    expect(recommendation.limitations[0]).toContain("does not yet have enough comparable account-level results");
  });

  it("deduplicates hashtags across every group instead of presenting a spammy repeated set", async () => {
    const fixture = dependencies();
    const recommendation = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "instagram",
    });

    expect(recommendation.hashtags.brand).toEqual(["#VillizPixels"]);
    expect(recommendation.hashtags.service).toEqual(["#PortraitPhotography"]);
  });

  it("does not call AI when the operator has reviewer-only access", async () => {
    const fixture = dependencies({ role: "reviewer" });

    await expect(
      generateEngagementRecommendation(fixture.deps, {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "instagram",
      }),
    ).rejects.toThrow("do not have permission");
    expect(fixture.ai.generateObject).not.toHaveBeenCalled();
  });

  it("does not call AI without active MemBrain evidence", async () => {
    const fixture = dependencies({ withContext: false });

    await expect(
      generateEngagementRecommendation(fixture.deps, {
        organisationId: ORG_ID,
        draftId: DRAFT_ID,
        platform: "instagram",
      }),
    ).rejects.toThrow("Add active MemBrain knowledge");
    expect(fixture.ai.generateObject).not.toHaveBeenCalled();
  });

  it("keeps the ranked MemBrain query inside the existing 500-character retrieval contract", async () => {
    const fixture = dependencies();
    await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "instagram",
      objective: "x".repeat(300),
    });

    const membrain = fixture.deps.membrain as unknown as { retrieveContext: ReturnType<typeof vi.fn> };
    expect(membrain.retrieveContext.mock.calls[0]?.[0].query.length).toBeLessThanOrEqual(500);
  });
});

describe("Sprint 13 account-scoped learning overview", () => {
  it("queries performance only for the one resolved Blotato destination", async () => {
    const fixture = dependencies();
    const listMetricSnapshots = vi.fn(async () => []);
    fixture.deps.engagement.listMetricSnapshots = listMetricSnapshots;
    fixture.deps.engagement.listMetricSnapshotsForDraft = vi.fn(async () => []);
    fixture.deps.engagement.findLatestFeedback = vi.fn(async () => null);
    const overview = await getEngagementLearningOverview({
      actor: fixture.deps.actor,
      organisations: fixture.deps.organisations,
      engagement: fixture.deps.engagement,
      blotatoAccounts: fixture.deps.blotatoAccounts,
    }, { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram", objectiveType: "bookings" });
    expect(overview.accountScope).toBe("account_scoped");
    expect(overview.providerAccountId).toBe("account-1");
    expect(listMetricSnapshots).toHaveBeenCalledWith(ORG_ID, "instagram", "bookings", "account-1");
  });

  it("does not mix performance when more than one account can publish to the platform", async () => {
    const fixture = dependencies();
    vi.mocked(fixture.deps.blotatoAccounts.findActiveForOrganisationAndPlatform).mockResolvedValue([
      { id: "account-1" }, { id: "account-2" },
    ] as never);
    const listMetricSnapshots = vi.fn(async () => []);
    fixture.deps.engagement.listMetricSnapshots = listMetricSnapshots;
    fixture.deps.engagement.listMetricSnapshotsForDraft = vi.fn(async () => []);
    fixture.deps.engagement.findLatestFeedback = vi.fn(async () => null);
    const overview = await getEngagementLearningOverview({
      actor: fixture.deps.actor,
      organisations: fixture.deps.organisations,
      engagement: fixture.deps.engagement,
      blotatoAccounts: fixture.deps.blotatoAccounts,
    }, { organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram", objectiveType: "engagement" });
    expect(overview.accountScope).toBe("multiple_accounts");
    expect(overview.performanceSummary.sampleSize).toBe(0);
    expect(listMetricSnapshots).not.toHaveBeenCalled();
  });
});

describe("engagement intelligence database contract", () => {
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, "../supabase/migrations/20260810160000_engagement_intelligence.sql"),
    "utf8",
  );

  it("keeps recommendations organisation-scoped and immutable to authenticated users", () => {
    expect(migration).toContain("foreign key (draft_id, organisation_id)");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("app.is_org_member(organisation_id)");
    expect(migration).toContain("revoke update, delete on public.engagement_recommendations from authenticated");
  });

  it("emits metadata-only automation events without captions, hashtags or evidence", () => {
    const eventBody = migration.split("create or replace function app.emit_engagement_recommendation_event()")[1] ?? "";
    expect(eventBody).toContain("'engagement.recommendation_generated'");
    expect(eventBody).not.toContain("new.recommended_caption");
    expect(eventBody).not.toContain("new.hashtag_groups");
    expect(eventBody).not.toContain("new.evidence");
  });
});

describe("Sprint 11 learning-loop database contract", () => {
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, "../supabase/migrations/20260810180000_engagement_learning_loop.sql"),
    "utf8",
  );

  it("keeps feedback append-only and provider snapshots service-role-only", () => {
    expect(migration).toContain("revoke update, delete on public.engagement_feedback_events from authenticated");
    expect(migration).toContain("revoke insert, update, delete on public.engagement_metric_snapshots from authenticated");
    expect(migration).toContain("engagement_metrics_attempt_scope_fkey");
    expect(migration).toContain("engagement_metric_snapshots_immutable");
    expect(migration).toContain("(organisation_id, provider_snapshot_key)");
  });

  it("emits feedback metadata without caption or hashtag snapshots", () => {
    const eventBody = migration.split("create or replace function app.emit_engagement_feedback_event()")[1] ?? "";
    expect(eventBody).toContain("'engagement.recommendation_selected'");
    expect(eventBody).not.toContain("new.caption_snapshot");
    expect(eventBody).not.toContain("new.hashtag_snapshot");
  });
});

describe("Sprint 13 learning-operations database contract", () => {
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, "../supabase/migrations/20260810190000_engagement_learning_operations.sql"),
    "utf8",
  );

  it("backfills and indexes immutable metrics by exact provider account", () => {
    expect(migration).toContain("drop trigger if exists engagement_metric_snapshots_immutable");
    expect(migration).toContain("add column provider_account_id text");
    expect(migration).toContain("provider_metadata ->> 'blotatoAccountId'");
    expect(migration).toContain("engagement_metrics_account_baseline_idx");
    expect(migration).toContain("where provider_account_id is not null");
    expect(migration).toContain("create trigger engagement_metric_snapshots_immutable");
  });
});
