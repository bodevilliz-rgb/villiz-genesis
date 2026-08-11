import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyEngagementRecommendation, generateEngagementRecommendation, getEngagementLearningOverview, recordEngagementCommercialOutcome } from "@/core/application/use-cases/engagement";
import type { AIProviderPort } from "@/core/application/ports/ai-provider-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { PublishingRepository } from "@/core/application/ports/publishing-port";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { EngagementRecommendationWriteModel } from "@/core/domain/entities/engagement";
import type { Actor } from "@/core/domain/entities/identity";
import { engagementRecommendationModelSchema } from "@/core/application/dto/engagement-dto";
import {
  linkedInReadinessScore,
} from "@/core/application/use-cases/engagement/linkedin-personal-profile";
import { assessEngagementDraftInput } from "@/core/application/use-cases/engagement/draft-input";

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

function dependencies(options: { role?: "lead" | "contributor" | "reviewer"; withContext?: boolean; draftBody?: string } = {}) {
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
    findDraft: vi.fn(async () => ({ ...draft, body: options.draftBody ?? draft.body })),
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
        linkedinPersonalProfile: null,
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
  it("blocks an explicit writing brief before retrieval or AI generation", async () => {
    const fixture = dependencies({
      draftBody: "professional introduction of myself as a professional photography and AI solution provider.",
    });
    await expect(generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin",
    })).rejects.toThrow("content brief rather than a finished post");
    expect(fixture.ai.generateObject).not.toHaveBeenCalled();
    expect(fixture.deps.membrain.retrieveContext).not.toHaveBeenCalled();
  });

  it("does not mistake a concise genuine post for a writing brief", () => {
    expect(assessEngagementDraftInput("Your story matters. What are you building next?").kind).toBe("finished_post");
    expect(assessEngagementDraftInput("Write a LinkedIn post about my photography business.").kind).toBe("content_brief");
  });

  it("calculates the readiness score from audited dimensions rather than a supplied total", () => {
    expect(linkedInReadinessScore({
      hook: 4, singleIdea: 5, personalVoice: 5, credibility: 3, scanability: 4, conversationCta: 5,
    })).toBe(87);
  });

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

  it("enforces personal-profile LinkedIn guidance and recalculates editorial readiness", async () => {
    const fixture = dependencies();
    vi.mocked(fixture.ai.generateObject).mockResolvedValueOnce({
      recommendedCaption: "One lesson I learned while creating portraits.\n\nClarity builds confidence.\n\nWhat has helped you feel prepared?",
      alternativeCaptions: ["A personal professional lesson."],
      hook: "One lesson I learned while creating portraits.",
      cta: "What has helped you feel prepared?",
      hashtags: { brand: ["#VillizPixels"], local: [], service: ["#PortraitPhotography"], audience: [] },
      rationale: "A person-led lesson invites a relevant professional conversation.",
      predictedStrengths: ["Personal opening"],
      limitations: [],
      creativeGuidance: {
        mediaBasis: "none",
        visualHook: "Use a relevant portrait.",
        formatRecommendation: "Use a text-led post.",
        shareTrigger: "Share the practical lesson.",
        saveTrigger: "Save the preparation insight.",
        accessibilityNote: "Add alt text when media is attached.",
        linkedinPersonalProfile: {
          accountType: "personal_profile",
          postArchetype: "lesson_learned",
          readinessScore: 99,
          audiencePromise: "A practical lesson about portrait confidence.",
          credibilityAnchor: "The existing draft and MemBrain-supported studio guidance.",
          conversationPrompt: "What has helped you feel prepared?",
          // Regression: production returned percentage-style provisional
          // values. They must not prevent the independent 0-5 audit running.
          dimensions: { hook: 90, singleIdea: 95, personalVoice: 92, credibility: 90, scanability: 94, conversationCta: 91 },
          improvementActions: ["Add one MemBrain-supported concrete example."],
        },
      },
      confidence: 82,
    }).mockResolvedValueOnce({
      dimensions: { hook: 4, singleIdea: 5, personalVoice: 5, credibility: 3, scanability: 4, conversationCta: 5 },
      audiencePromise: "A practical lesson about portrait confidence.",
      credibilityAnchor: "Studio guidance supported by the Brand voice entry.",
      credibilityEvidenceIds: [ENTRY_ID],
      conversationPrompt: "What has helped you feel prepared?",
      improvementActions: ["Add one MemBrain-supported concrete example."],
      blockingFindings: [],
    });

    const result = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID,
      draftId: DRAFT_ID,
      platform: "linkedin",
      objectiveType: "engagement",
    });

    expect(result.creativeGuidance.linkedinPersonalProfile).toEqual(expect.objectContaining({
      accountType: "personal_profile",
      readinessScore: 87,
      auditStatus: "passed",
      auditAttempts: 1,
      credibilityEvidenceIds: [ENTRY_ID],
    }));
    expect(result.creativeGuidance.linkedinPersonalProfile?.dimensions).toEqual({
      hook: 4,
      singleIdea: 5,
      personalVoice: 5,
      credibility: 3,
      scanability: 4,
      conversationCta: 5,
    });
    const options = vi.mocked(fixture.ai.generateObject).mock.calls[0]?.[2];
    expect(options?.systemPrompt).toContain("person's LinkedIn profile, never a company Page");
    expect(options?.systemPrompt).toContain("do not invent it");
    expect(vi.mocked(fixture.ai.generateObject).mock.calls[1]?.[0]).toContain("Alternative captions:");
    expect(vi.mocked(fixture.ai.generateObject).mock.calls[1]?.[0]).toContain("#VillizPixels");
    expect(vi.mocked(fixture.ai.generateObject).mock.calls[1]?.[0]).not.toContain('"readinessScore":99');
    expect(vi.mocked(fixture.ai.generateObject).mock.calls[1]?.[0]).not.toContain('"dimensions"');
    expect(vi.mocked(fixture.ai.generateObject).mock.calls[1]?.[2]?.systemPrompt).toContain("independent LinkedIn grounding");
  });

  it("repairs one rejected LinkedIn candidate, re-audits it and persists only the grounded replacement", async () => {
    const fixture = dependencies();
    const baseGeneration = await fixture.ai.generateObject("draft", engagementRecommendationModelSchema);
    const firstCandidate = {
      ...baseGeneration,
      recommendedCaption: "As Villiz Pixels' award-winning creative director, I guarantee more visibility.",
      creativeGuidance: {
        ...baseGeneration.creativeGuidance,
        linkedinPersonalProfile: {
          accountType: "personal_profile" as const,
          postArchetype: "point_of_view" as const,
          readinessScore: 100,
          audiencePromise: "A professional perspective.",
          credibilityAnchor: "Award-winning creative director.",
          conversationPrompt: "What do you think?",
          dimensions: { hook: 5, singleIdea: 5, personalVoice: 5, credibility: 5, scanability: 5, conversationCta: 5 },
          improvementActions: ["Reply promptly to comments to boost visibility."],
        },
      },
    };
    const repairedCandidate = {
      ...firstCandidate,
      recommendedCaption: "At Villiz Pixels, I guide clients through the portrait process.\n\nWhat should your next portrait communicate?",
      creativeGuidance: {
        ...firstCandidate.creativeGuidance,
        linkedinPersonalProfile: {
          ...firstCandidate.creativeGuidance.linkedinPersonalProfile!,
          credibilityAnchor: "Client guidance described in Brand voice.",
          improvementActions: ["Clarify the reader takeaway before publishing."],
        },
      },
    };
    vi.mocked(fixture.ai.generateObject).mockReset()
      .mockResolvedValueOnce(firstCandidate)
      .mockResolvedValueOnce({
        dimensions: { hook: 2, singleIdea: 3, personalVoice: 4, credibility: 0, scanability: 4, conversationCta: 3 },
        audiencePromise: "A professional perspective.", credibilityAnchor: "Unsupported credential.",
        credibilityEvidenceIds: [], conversationPrompt: "What do you think?", improvementActions: [],
        blockingFindings: [
          { type: "invented_credential", excerpt: "award-winning creative director", reason: "No MemBrain entry supports this title." },
          { type: "performance_promise", excerpt: "guarantee more visibility", reason: "Future visibility cannot be guaranteed." },
        ],
      })
      .mockResolvedValueOnce(repairedCandidate)
      .mockResolvedValueOnce({
        dimensions: { hook: 4, singleIdea: 5, personalVoice: 4, credibility: 3, scanability: 5, conversationCta: 4 },
        audiencePromise: "How guided portrait preparation supports a professional image.",
        credibilityAnchor: "Client guidance described in Brand voice.", credibilityEvidenceIds: [ENTRY_ID],
        conversationPrompt: "What should your next portrait communicate?",
        improvementActions: ["Clarify the reader takeaway before publishing."], blockingFindings: [],
      });

    const result = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin",
    });
    expect(result.recommendedCaption).toBe(repairedCandidate.recommendedCaption);
    expect(result.creativeGuidance.linkedinPersonalProfile).toEqual(expect.objectContaining({
      auditStatus: "passed", auditAttempts: 2, readinessScore: 83,
    }));
    expect(fixture.ai.generateObject).toHaveBeenCalledTimes(4);
    expect(fixture.getPersisted()?.recommendedCaption).toBe(repairedCandidate.recommendedCaption);
  });

  it("fails closed without persisting when the bounded LinkedIn repair still has unsupported claims", async () => {
    const fixture = dependencies();
    const candidate = await fixture.ai.generateObject("draft", engagementRecommendationModelSchema);
    const linkedinCandidate = {
      ...candidate,
      creativeGuidance: {
        ...candidate.creativeGuidance,
        linkedinPersonalProfile: {
          accountType: "personal_profile" as const, postArchetype: "point_of_view" as const, readinessScore: 100,
          audiencePromise: "Value", credibilityAnchor: "Invented title", conversationPrompt: "Question",
          dimensions: { hook: 5, singleIdea: 5, personalVoice: 5, credibility: 5, scanability: 5, conversationCta: 5 },
          improvementActions: ["Edit before publishing."],
        },
      },
    };
    const rejectedAudit = {
      dimensions: { hook: 3, singleIdea: 3, personalVoice: 3, credibility: 0, scanability: 3, conversationCta: 3 },
      audiencePromise: "Value", credibilityAnchor: "Unsupported", credibilityEvidenceIds: [],
      conversationPrompt: "Question", improvementActions: ["Remove the unsupported title."],
      blockingFindings: [{ type: "invented_credential" as const, excerpt: "Invented title", reason: "Not in MemBrain." }],
    };
    vi.mocked(fixture.ai.generateObject).mockReset()
      .mockResolvedValueOnce(linkedinCandidate).mockResolvedValueOnce(rejectedAudit)
      .mockResolvedValueOnce(linkedinCandidate).mockResolvedValueOnce(rejectedAudit);
    await expect(generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID, draftId: DRAFT_ID, platform: "linkedin",
    })).rejects.toThrow("could not verify");
    expect(fixture.getPersisted()).toBeNull();
  });

  it("removes LinkedIn guidance from recommendations for other platforms", async () => {
    const fixture = dependencies();
    const original = await vi.mocked(fixture.ai.generateObject)("draft", engagementRecommendationModelSchema);
    vi.mocked(fixture.ai.generateObject).mockReset();
    vi.mocked(fixture.ai.generateObject).mockResolvedValueOnce({
      ...(original as Record<string, unknown>),
      creativeGuidance: {
        ...((original as { creativeGuidance: Record<string, unknown> }).creativeGuidance),
        linkedinPersonalProfile: {
          accountType: "personal_profile", postArchetype: "how_to", readinessScore: 100,
          audiencePromise: "Value", credibilityAnchor: "Evidence", conversationPrompt: "Question",
          dimensions: { hook: 5, singleIdea: 5, personalVoice: 5, credibility: 5, scanability: 5, conversationCta: 5 },
          improvementActions: ["None"],
        },
      },
    });
    const result = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram",
    });
    expect(result.creativeGuidance.linkedinPersonalProfile).toBeNull();
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

describe("Sprint 14 publish-to-learn contract", () => {
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, "../supabase/migrations/20260810200000_publish_to_learn.sql"),
    "utf8",
  );

  it("applies the draft and inserts attribution inside one security-invoker transaction", () => {
    expect(migration).toContain("public.apply_engagement_recommendation");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("for update");
    expect(migration).toContain("set body = p_caption_snapshot");
    expect(migration).toContain("insert into public.engagement_feedback_events");
    expect(migration).toContain("applied_draft_version");
  });

  it("keeps commercial outcomes append-only and performance checkpoints fixed", () => {
    expect(migration).toContain("engagement_measurement_window");
    expect(migration).toContain("'24h', '72h', '7d'");
    expect(migration).toContain("create table public.engagement_commercial_outcomes");
    expect(migration).toContain("revoke update, delete on public.engagement_commercial_outcomes from authenticated");
    expect(migration).toContain("engagement_outcomes_attempt_scope_fkey");
  });

  it("uses the atomic repository path for selected recommendations", async () => {
    const fixture = dependencies();
    const recommendation = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram",
    });
    fixture.deps.engagement.findById = vi.fn(async () => recommendation);
    const applyRecommendation = vi.fn(async () => ({
      draftVersion: 4,
      feedback: {
        id: "feedback-1", organisationId: ORG_ID, draftId: DRAFT_ID,
        recommendationId: recommendation.id, action: "selected" as const,
        variant: "recommended" as const, captionSnapshot: recommendation.recommendedCaption,
        hashtagSnapshot: ["#VillizPixels", "#CoventryPhotographer", "#PortraitPhotography", "#CoventryCreatives"],
        reason: "Applied atomically to draft", createdBy: ACTOR_ID,
        createdAt: "2026-08-10T20:00:00Z", appliedDraftVersion: 4,
      },
    }));
    fixture.deps.engagement.applyRecommendation = applyRecommendation;
    const result = await applyEngagementRecommendation({
      actor: fixture.deps.actor, organisations: fixture.deps.organisations,
      engagement: fixture.deps.engagement, content: fixture.deps.content,
    }, {
      organisationId: ORG_ID, draftId: DRAFT_ID, recommendationId: recommendation.id,
      action: "selected", variant: "recommended", captionSnapshot: recommendation.recommendedCaption,
      hashtagSnapshot: ["#VillizPixels", "#CoventryPhotographer", "#PortraitPhotography", "#CoventryCreatives"],
    });
    expect(result.draftVersion).toBe(4);
    expect(applyRecommendation).toHaveBeenCalledOnce();
  });

  it("refuses to apply a legacy LinkedIn recommendation without an independent audit", async () => {
    const fixture = dependencies();
    const recommendation = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram",
    });
    const legacyLinkedIn = {
      ...recommendation,
      platform: "linkedin" as const,
      creativeGuidance: {
        ...recommendation.creativeGuidance,
        linkedinPersonalProfile: {
          accountType: "personal_profile" as const, postArchetype: "point_of_view" as const,
          readinessScore: 90, audiencePromise: "Value", credibilityAnchor: "Legacy claim",
          conversationPrompt: "Question",
          dimensions: { hook: 5, singleIdea: 5, personalVoice: 4, credibility: 4, scanability: 5, conversationCta: 4 },
          improvementActions: ["Legacy advice"],
        },
      },
    };
    fixture.deps.engagement.findById = vi.fn(async () => legacyLinkedIn);
    const applyRecommendation = vi.fn();
    fixture.deps.engagement.applyRecommendation = applyRecommendation;
    await expect(applyEngagementRecommendation({
      actor: fixture.deps.actor, organisations: fixture.deps.organisations,
      engagement: fixture.deps.engagement, content: fixture.deps.content,
    }, {
      organisationId: ORG_ID, draftId: DRAFT_ID, recommendationId: legacyLinkedIn.id,
      action: "selected", variant: "recommended", captionSnapshot: legacyLinkedIn.recommendedCaption,
      hashtagSnapshot: ["#VillizPixels"],
    })).rejects.toThrow("predates independent grounding");
    expect(applyRecommendation).not.toHaveBeenCalled();
  });

  it("refuses to apply custom LinkedIn text that did not receive the recommendation audit", async () => {
    const fixture = dependencies();
    const recommendation = await generateEngagementRecommendation(fixture.deps, {
      organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram",
    });
    const auditedLinkedIn = {
      ...recommendation,
      platform: "linkedin" as const,
      creativeGuidance: {
        ...recommendation.creativeGuidance,
        linkedinPersonalProfile: {
          accountType: "personal_profile" as const, postArchetype: "point_of_view" as const,
          readinessScore: 80, audiencePromise: "Value", credibilityAnchor: "Supported",
          conversationPrompt: "Question",
          dimensions: { hook: 4, singleIdea: 4, personalVoice: 4, credibility: 4, scanability: 4, conversationCta: 4 },
          improvementActions: [], auditStatus: "passed" as const, auditAttempts: 1 as const,
          credibilityEvidenceIds: [ENTRY_ID],
        },
      },
    };
    fixture.deps.engagement.findById = vi.fn(async () => auditedLinkedIn);
    const applyRecommendation = vi.fn();
    fixture.deps.engagement.applyRecommendation = applyRecommendation;
    await expect(applyEngagementRecommendation({
      actor: fixture.deps.actor, organisations: fixture.deps.organisations,
      engagement: fixture.deps.engagement, content: fixture.deps.content,
    }, {
      organisationId: ORG_ID, draftId: DRAFT_ID, recommendationId: auditedLinkedIn.id,
      action: "selected", variant: "custom", captionSnapshot: "An unaudited custom edit",
      hashtagSnapshot: ["#VillizPixels"],
    })).rejects.toThrow("exact text can be audited");
    expect(applyRecommendation).not.toHaveBeenCalled();
  });

  it("records revenue outcomes only against the exact real destination attempt", async () => {
    const fixture = dependencies();
    const createCommercialOutcome = vi.fn(async (input) => ({ id: "outcome-1", createdAt: "2026-08-10T20:00:00Z", ...input }));
    fixture.deps.engagement.createCommercialOutcome = createCommercialOutcome;
    const publishing = {
      listAttemptsForAnalytics: vi.fn(async () => [{
        id: "attempt-1", jobId: "job-1", organisationId: ORG_ID, draftId: DRAFT_ID,
        platform: "instagram", attemptNumber: 1, status: "completed",
        queuedAt: "2026-08-09T00:00:00Z", startedAt: "2026-08-09T00:00:01Z",
        completedAt: "2026-08-09T00:00:02Z", failedAt: null, durationMs: 1000,
        externalPostId: "post-1", externalUrl: null, errorCode: null, errorMessage: null,
        retryOfAttemptId: null, providerMetadata: { blotatoAccountId: "account-1" },
        createdAt: "2026-08-09T00:00:00Z",
      }]),
    } as unknown as PublishingRepository;
    const outcome = await recordEngagementCommercialOutcome({
      actor: fixture.deps.actor, organisations: fixture.deps.organisations,
      engagement: fixture.deps.engagement, blotatoAccounts: fixture.deps.blotatoAccounts,
      publishing,
    }, {
      organisationId: ORG_ID, draftId: DRAFT_ID, platform: "instagram",
      enquiries: 3, bookings: 1, revenueMinor: 25000, currency: "GBP", note: "One portrait booking",
    });
    expect(outcome.publishingAttemptId).toBe("attempt-1");
    expect(createCommercialOutcome).toHaveBeenCalledWith(expect.objectContaining({
      providerAccountId: "account-1", revenueMinor: 25000, createdBy: ACTOR_ID,
    }));
  });
});

describe("Sprint 15.1 LinkedIn audit database guard", () => {
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, "../supabase/migrations/20260810210000_linkedin_personal_profile_audit_guard.sql"),
    "utf8",
  );

  it("rejects a direct RPC apply for unaudited LinkedIn guidance", () => {
    expect(migration).toContain("v_recommendation.platform = 'linkedin'");
    expect(migration).toContain("{linkedinPersonalProfile,auditStatus}");
    expect(migration).toContain("<> 'passed'");
    expect(migration).toContain("requires independent grounding");
    expect(migration).toContain("p_variant = 'custom'");
    expect(migration).toContain("Save custom LinkedIn wording as the draft");
  });
});
