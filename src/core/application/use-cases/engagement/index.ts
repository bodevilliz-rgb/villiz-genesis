import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import { canWriteContent, type Actor } from "@/core/domain/entities/identity";
import type { AIProviderPort } from "@/core/application/ports/ai-provider-port";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { MediaRepository } from "@/core/application/ports/media-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { PublishingRepository } from "@/core/application/ports/publishing-port";
import {
  engagementRecommendationModelSchema,
  generateEngagementRecommendationSchema,
  type EngagementRecommendationModelOutput,
  recordEngagementFeedbackSchema,
  applyEngagementRecommendationSchema,
  recordCommercialOutcomeSchema,
} from "@/core/application/dto/engagement-dto";
import type {
  EngagementEvidence,
  EngagementHashtagGroups,
  EngagementRecommendation,
  EngagementFeedbackEvent,
  EngagementLearningOverview,
  EngagementApplicationResult,
  EngagementCommercialOutcome,
} from "@/core/domain/entities/engagement";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import { isSimulatedPublishingAttempt, type PublishingPlatform } from "@/core/domain/entities/publishing";
import { toBlotatoPlatform } from "@/core/domain/entities/blotato";
import { retrieveContext } from "@/core/application/use-cases/membrain";
import { performanceSummary } from "./performance";
import {
  LINKEDIN_PERSONAL_PROFILE_RULES,
  normaliseLinkedInPersonalProfileGuidance,
} from "./linkedin-personal-profile";

interface EngagementDeps {
  actor: Actor;
  organisations: OrganisationRepository;
  campaigns: CampaignRepository;
  content: ContentRepository;
  membrain: MembrainRepository;
  engagement: EngagementRepository;
  blotatoAccounts: BlotatoAccountRepository;
  media?: MediaRepository;
  ai: AIProviderPort;
}

const BRAND_ONLY_CONFIDENCE_CAP = 70;
const BRAND_ONLY_LIMITATION =
  "Brand-informed recommendation only. Genesis does not yet have enough comparable account-level results to call this performance-informed.";

const PUBLISHABLE_ENGAGEMENT_PLATFORMS = new Set<CampaignPlatform>([
  "instagram", "facebook", "linkedin", "x", "tiktok",
]);

async function resolveLearningAccount(
  blotatoAccounts: BlotatoAccountRepository,
  organisationId: string,
  platform: CampaignPlatform,
): Promise<{ accountScope: EngagementLearningOverview["accountScope"]; providerAccountId: string | null }> {
  if (!PUBLISHABLE_ENGAGEMENT_PLATFORMS.has(platform)) {
    return { accountScope: "no_account", providerAccountId: null };
  }
  const accounts = await blotatoAccounts.findActiveForOrganisationAndPlatform(
    toBlotatoPlatform(platform as PublishingPlatform),
    organisationId,
  );
  if (accounts.length === 0) return { accountScope: "no_account", providerAccountId: null };
  if (accounts.length > 1) return { accountScope: "multiple_accounts", providerAccountId: null };
  return { accountScope: "account_scoped", providerAccountId: accounts[0]!.id };
}

function nonBlank(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueHashtags(groups: EngagementHashtagGroups): EngagementHashtagGroups {
  const seen = new Set<string>();
  const clean = (values: string[]) =>
    values.filter((value) => {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    brand: clean(groups.brand),
    local: clean(groups.local),
    service: clean(groups.service),
    audience: clean(groups.audience),
  };
}

function normaliseModelOutput(
  output: EngagementRecommendationModelOutput,
  isPerformanceInformed = false,
  platform?: CampaignPlatform,
): EngagementRecommendationModelOutput {
  const linkedinGuidance = platform === "linkedin" && output.creativeGuidance.linkedinPersonalProfile
    ? normaliseLinkedInPersonalProfileGuidance(output.creativeGuidance.linkedinPersonalProfile)
    : null;
  return {
    ...output,
    alternativeCaptions: [...new Set(output.alternativeCaptions)].slice(0, 2),
    hashtags: uniqueHashtags(output.hashtags),
    limitations: isPerformanceInformed
      ? output.limitations.slice(0, 5)
      : [BRAND_ONLY_LIMITATION, ...output.limitations.filter((item) => item !== BRAND_ONLY_LIMITATION)].slice(0, 5),
    confidence: Math.min(output.confidence, BRAND_ONLY_CONFIDENCE_CAP),
    creativeGuidance: {
      ...output.creativeGuidance,
      linkedinPersonalProfile: linkedinGuidance,
    },
  };
}

function buildSystemPrompt(input: {
  organisationName: string;
  platform: string;
  objective: string;
  contextPrompt: string;
  performancePrompt: string;
  mediaPrompt: string;
  platformRules: string;
}) {
  return `You are AWO Engagement Intelligence for ${input.organisationName}.

Create an evidence-grounded social post recommendation for ${input.platform}.
Objective: ${input.objective}

Authoritative MemBrain context:
${input.contextPrompt}

Historical performance context (directional, never causal):
${input.performancePrompt}

Attached-media metadata (not pixel-level visual analysis):
${input.mediaPrompt}

Platform-specific mode:
${input.platformRules}

Rules:
- Treat MemBrain as the only source of brand facts, claims, location, services, audience, CTA rules and hashtag strategy.
- Never invent an offer, statistic, testimonial, price, location, trend or platform rule.
- Do not claim or imply that engagement is guaranteed.
- Optimise for clarity, relevance, a strong opening hook and a truthful CTA.
- Suggest only relevant hashtags. Group them as brand, local, service and audience; use an empty array when the context cannot support a group.
- Do not put reasoning or confidence claims inside the caption.
- Creative guidance must be actionable and must not claim to have visually inspected media. Set mediaBasis to metadata_only when metadata is present, otherwise none.
- Treat historical scores as directional evidence, not proof that a caption caused an outcome.
- Return structured data matching the supplied schema.`;
}

export async function generateEngagementRecommendation(
  deps: EngagementDeps,
  raw: unknown,
): Promise<EngagementRecommendation> {
  const parsed = generateEngagementRecommendationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Check the engagement request.", parsed.error.flatten().fieldErrors);
  }

  const input = parsed.data;
  const role = await deps.organisations.viewerRole(input.organisationId);
  if (!canWriteContent(deps.actor, role)) {
    throw new ForbiddenError("You do not have permission to request engagement intelligence for this organisation.");
  }

  const [organisation, draft] = await Promise.all([
    deps.organisations.findById(input.organisationId),
    deps.content.findDraft(input.organisationId, input.draftId),
  ]);

  if (!organisation) throw new NotFoundError("Organisation");
  if (!draft) throw new NotFoundError("Draft");
  if (!new Set(["social_post", "caption", "campaign_copy", "ad_copy", "video_script"]).has(draft.contentType)) {
    throw new ValidationError("Engagement intelligence is currently available for social content only.");
  }
  if (!draft.body.trim()) {
    throw new ValidationError("Write and save some draft content before requesting engagement intelligence.");
  }

  const campaign = draft.campaign
    ? await deps.campaigns.findCampaign(input.organisationId, draft.campaign.id)
    : null;
  const objective =
    nonBlank(input.objective) ??
    nonBlank(campaign?.objective) ??
    `Improve relevant engagement with this ${draft.contentType.replaceAll("_", " ")}`;

  const contextQuery = [
    draft.title,
    objective,
    "brand voice audience CTA hashtag strategy location services business goals customer journey content performance spokesperson identity role expertise experience proof",
  ]
    .join(" ")
    .slice(0, 500);

  const contextPack = await retrieveContext(
    { actor: deps.actor, membrain: deps.membrain, organisations: deps.organisations },
    {
      organisationId: input.organisationId,
      query: contextQuery,
      limit: 24,
      maxCharacters: 32000,
      recordUsage: true,
    },
  );

  if (contextPack.items.length === 0) {
    throw new ValidationError("Add active MemBrain knowledge before requesting engagement intelligence.");
  }

  const account = await resolveLearningAccount(deps.blotatoAccounts, input.organisationId, input.platform);
  const [snapshots, mediaAssets] = await Promise.all([
    account.providerAccountId
      ? deps.engagement.listMetricSnapshots?.(input.organisationId, input.platform, input.objectiveType, account.providerAccountId) ?? Promise.resolve([])
      : Promise.resolve([]),
    deps.media?.listAssetsForDraft(input.draftId) ?? Promise.resolve([]),
  ]);
  const performance = performanceSummary(snapshots, input.objectiveType);
  const hasPerformanceContext = performance.sampleSize >= performance.minimumSampleSize;
  const isPerformanceInformed = performance.label === "performance_informed";
  const mediaPrompt = mediaAssets.length === 0
    ? "No media is attached."
    : mediaAssets.slice(0, 8).map((asset) => [
        `Asset ${asset.id}: ${asset.title ?? asset.fileName}`,
        `type=${asset.mimeType}`,
        asset.width && asset.height ? `dimensions=${asset.width}x${asset.height}` : null,
        asset.duration ? `durationSeconds=${asset.duration}` : null,
        asset.description ? `description=${asset.description}` : null,
        asset.altText ? `altText=${asset.altText}` : null,
        asset.tags.length ? `tags=${asset.tags.join(", ")}` : null,
      ].filter(Boolean).join("; ")).join("\n");
  const performancePrompt = hasPerformanceContext
    ? `${performance.sampleSize} comparable ${input.platform} posts for the ${input.objectiveType} objective; mean directional score ${performance.directionalScore ?? "unavailable"} per 1,000 reach/views. Performance confidence ${performance.performanceConfidence}%. ${performance.championVariant ? `Current champion variant: ${performance.championVariant}; challenger: ${performance.challengerVariant}. Treat this as a testable pattern, not causal proof.` : "No champion/challenger comparison has enough attributed observations yet."}`
    : `${performance.sampleSize}/${performance.minimumSampleSize} comparable posts. Insufficient data for performance-informed claims.`;

  const prompt = `Draft title: ${draft.title}\nDraft version: ${draft.version}\nCurrent draft:\n${draft.body}`;
  const modelOutput = await deps.ai.generateObject(prompt, engagementRecommendationModelSchema, {
    systemPrompt: buildSystemPrompt({
      organisationName: organisation.name,
      platform: input.platform,
      objective,
      contextPrompt: contextPack.prompt,
      performancePrompt,
      mediaPrompt,
      platformRules: input.platform === "linkedin"
        ? LINKEDIN_PERSONAL_PROFILE_RULES
        : "This is not LinkedIn. Set creativeGuidance.linkedinPersonalProfile to null.",
    }),
    temperature: 0.25,
  });
  if (input.platform === "linkedin" && !modelOutput.creativeGuidance.linkedinPersonalProfile) {
    throw new ValidationError("LinkedIn personal-profile guidance was incomplete. Generate the recommendation again.");
  }
  const recommendation = normaliseModelOutput(modelOutput, isPerformanceInformed, input.platform);

  const evidence: EngagementEvidence[] = contextPack.items.map((item) => ({
    sourceType: "membrain_entry",
    sourceId: item.id,
    title: item.title,
    categoryKey: item.categoryKey,
    version: item.version,
  }));
  evidence.push(...mediaAssets.map((asset) => ({
    sourceType: "media_asset" as const,
    sourceId: asset.id,
    title: asset.title ?? asset.fileName,
  })));
  evidence.push(...[...new Map(snapshots.map((snapshot) => [snapshot.externalPostId, snapshot])).values()].slice(0, 20).map((snapshot) => ({
    sourceType: "performance_snapshot" as const,
    sourceId: snapshot.id,
    title: `${input.platform} result observed ${snapshot.observedAt.slice(0, 10)}`,
  })));

  return deps.engagement.create({
    organisationId: input.organisationId,
    draftId: input.draftId,
    draftVersion: draft.version,
    platform: input.platform,
    objectiveType: input.objectiveType,
    objective,
    dataBasis: isPerformanceInformed ? "performance_informed" : "brand_only",
    recommendedCaption: recommendation.recommendedCaption,
    alternativeCaptions: recommendation.alternativeCaptions,
    hook: recommendation.hook,
    cta: recommendation.cta,
    hashtags: recommendation.hashtags,
    rationale: recommendation.rationale,
    predictedStrengths: recommendation.predictedStrengths,
    limitations: recommendation.limitations,
    creativeGuidance: {
      ...recommendation.creativeGuidance,
      mediaBasis: mediaAssets.length > 0 ? "metadata_only" : "none",
    },
    confidence: recommendation.confidence,
    performanceConfidence: performance.performanceConfidence,
    performanceSummary: performance,
    evidence,
    createdBy: deps.actor.id,
  });
}

export async function recordEngagementFeedback(
  deps: Pick<EngagementDeps, "actor" | "organisations" | "engagement" | "content">,
  raw: unknown,
): Promise<EngagementFeedbackEvent> {
  const parsed = recordEngagementFeedbackSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the engagement feedback.", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const role = await deps.organisations.viewerRole(input.organisationId);
  if (!canWriteContent(deps.actor, role)) throw new ForbiddenError("You do not have permission to record engagement feedback.");
  if (input.action === "selected") {
    throw new ValidationError("Use Apply recommendation so the draft update and learning record remain atomic.");
  }
  if (!deps.engagement.findById || !deps.engagement.createFeedback) throw new ValidationError("Engagement feedback storage is not available.");
  const recommendation = await deps.engagement.findById(input.organisationId, input.recommendationId);
  if (!recommendation || recommendation.draftId !== input.draftId) throw new NotFoundError("Engagement recommendation");
  const draft = await deps.content.findDraft(input.organisationId, input.draftId);
  if (!draft) throw new NotFoundError("Draft");
  return deps.engagement.createFeedback({
    ...input,
    reason: input.reason?.trim() || null,
    createdBy: deps.actor.id,
  });
}

export async function applyEngagementRecommendation(
  deps: Pick<EngagementDeps, "actor" | "organisations" | "engagement" | "content">,
  raw: unknown,
): Promise<EngagementApplicationResult> {
  const parsed = applyEngagementRecommendationSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the recommendation selection.", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const role = await deps.organisations.viewerRole(input.organisationId);
  if (!canWriteContent(deps.actor, role)) throw new ForbiddenError("You do not have permission to apply engagement recommendations.");
  if (!deps.engagement.applyRecommendation) throw new ValidationError("Atomic recommendation application is not available.");
  const recommendation = await deps.engagement.findById?.(input.organisationId, input.recommendationId);
  if (!recommendation || recommendation.draftId !== input.draftId) throw new NotFoundError("Engagement recommendation");
  const draft = await deps.content.findDraft(input.organisationId, input.draftId);
  if (!draft) throw new NotFoundError("Draft");
  if (recommendation.draftVersion !== draft.version) {
    throw new ValidationError("This recommendation is outdated. Generate a new recommendation before applying it.");
  }
  return deps.engagement.applyRecommendation({
    organisationId: input.organisationId, draftId: input.draftId,
    recommendationId: input.recommendationId, variant: input.variant,
    captionSnapshot: input.captionSnapshot, hashtagSnapshot: input.hashtagSnapshot,
  });
}

function nextScheduledCollectionAt(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 15));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function attemptAccountId(metadata: Record<string, unknown>): string | null {
  const value = metadata.blotatoAccountId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function getLatestEngagementRecommendation(
  deps: Pick<EngagementDeps, "actor" | "organisations" | "engagement">,
  organisationId: string,
  draftId: string,
): Promise<EngagementRecommendation | null> {
  const role = await deps.organisations.viewerRole(organisationId);
  if (!deps.actor.isPlatformAdmin && !role) throw new ForbiddenError();
  return deps.engagement.findLatest(organisationId, draftId);
}

export async function getEngagementLearningOverview(
  deps: Pick<EngagementDeps, "actor" | "organisations" | "engagement" | "blotatoAccounts"> & { publishing?: PublishingRepository },
  input: { organisationId: string; draftId: string; platform: CampaignPlatform; objectiveType: EngagementLearningOverview["objectiveType"] },
): Promise<EngagementLearningOverview> {
  const role = await deps.organisations.viewerRole(input.organisationId);
  if (!deps.actor.isPlatformAdmin && !role) throw new ForbiddenError();
  const account = await resolveLearningAccount(deps.blotatoAccounts, input.organisationId, input.platform);
  const [latestFeedback, scopedSnapshots, draftSnapshots, commercialOutcomes, latestCommercialOutcome, attempts] = await Promise.all([
    deps.engagement.findLatestFeedback?.(input.organisationId, input.draftId) ?? Promise.resolve(null),
    account.providerAccountId
      ? deps.engagement.listMetricSnapshots?.(
          input.organisationId, input.platform, input.objectiveType, account.providerAccountId,
        ) ?? Promise.resolve([])
      : Promise.resolve([]),
    deps.engagement.listMetricSnapshotsForDraft?.(input.organisationId, input.draftId) ?? Promise.resolve([]),
    account.providerAccountId
      ? deps.engagement.listCommercialOutcomes?.(input.organisationId, input.platform, account.providerAccountId) ?? Promise.resolve([])
      : Promise.resolve([]),
    deps.engagement.findLatestCommercialOutcomeForDraft?.(input.organisationId, input.draftId, input.platform) ?? Promise.resolve(null),
    deps.publishing && account.providerAccountId
      ? deps.publishing.listAttemptsForAnalytics(input.organisationId, {
          status: "completed", requireExternalPostId: true, newestFirst: true, limit: 100,
        })
      : Promise.resolve([]),
  ]);
  const latestDraftMetric = draftSnapshots.find((snapshot) =>
    snapshot.platform === input.platform
      && (!account.providerAccountId || snapshot.providerAccountId === account.providerAccountId),
  ) ?? null;
  const eligibleAttempts = attempts.filter((attempt) =>
    attempt.platform === input.platform && !isSimulatedPublishingAttempt(attempt)
      && attemptAccountId(attempt.providerMetadata) === account.providerAccountId,
  );
  const scopedAttemptIds = new Set(scopedSnapshots.map((snapshot) => snapshot.publishingAttemptId));
  const sevenDayAttemptIds = new Set(scopedSnapshots.filter((snapshot) => snapshot.measurementWindow === "7d")
    .map((snapshot) => snapshot.publishingAttemptId));
  const missingAnalytics = eligibleAttempts.filter((attempt) => !scopedAttemptIds.has(attempt.id)).length;
  const missingAttribution = new Set(scopedSnapshots.filter((snapshot) => !snapshot.recommendationId || !snapshot.feedbackEventId)
    .map((snapshot) => snapshot.publishingAttemptId)).size;
  const awaitingSevenDay = eligibleAttempts.filter((attempt) => scopedAttemptIds.has(attempt.id) && !sevenDayAttemptIds.has(attempt.id)).length;
  const exclusions = [
    { code: "missing_analytics" as const, count: missingAnalytics, label: "Published posts waiting for provider analytics" },
    { code: "missing_attribution" as const, count: missingAttribution, label: "Posts without an exact applied recommendation match" },
    { code: "awaiting_7d_checkpoint" as const, count: awaitingSevenDay, label: "Posts still waiting for the comparable 7-day checkpoint" },
  ].filter((item) => item.count > 0);
  const draftWindows = new Set(draftSnapshots.map((snapshot) => snapshot.measurementWindow));
  const lastAnalyticsSyncAt = [...scopedSnapshots, ...draftSnapshots]
    .map((snapshot) => snapshot.createdAt).sort().at(-1) ?? null;
  return {
    platform: input.platform,
    objectiveType: input.objectiveType,
    ...account,
    latestFeedback,
    latestDraftMetric,
    latestCommercialOutcome,
    lastAnalyticsSyncAt,
    nextScheduledCollectionAt: nextScheduledCollectionAt(),
    checkpoints: {
      hours24: draftWindows.has("24h") || draftWindows.has("72h") || draftWindows.has("7d"),
      hours72: draftWindows.has("72h") || draftWindows.has("7d"),
      days7: draftWindows.has("7d"),
    },
    exclusions,
    performanceSummary: performanceSummary(scopedSnapshots, input.objectiveType, commercialOutcomes),
  };
}

export async function recordEngagementCommercialOutcome(
  deps: Pick<EngagementDeps, "actor" | "organisations" | "engagement" | "blotatoAccounts"> & { publishing: PublishingRepository },
  raw: unknown,
): Promise<EngagementCommercialOutcome> {
  const parsed = recordCommercialOutcomeSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the commercial outcome.", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const role = await deps.organisations.viewerRole(input.organisationId);
  if (!canWriteContent(deps.actor, role)) throw new ForbiddenError("You do not have permission to record commercial outcomes.");
  if (input.bookings > input.enquiries) throw new ValidationError("Bookings cannot exceed enquiries.");
  if (!deps.engagement.createCommercialOutcome) throw new ValidationError("Commercial outcome storage is not available.");
  const account = await resolveLearningAccount(deps.blotatoAccounts, input.organisationId, input.platform);
  if (!account.providerAccountId) throw new ValidationError("Choose one active destination account before recording outcomes.");
  const attempts = await deps.publishing.listAttemptsForAnalytics(input.organisationId, {
    draftId: input.draftId, status: "completed", requireExternalPostId: true, newestFirst: true, limit: 20,
  });
  const attempt = attempts.find((candidate) => candidate.platform === input.platform
    && !isSimulatedPublishingAttempt(candidate)
    && attemptAccountId(candidate.providerMetadata) === account.providerAccountId);
  if (!attempt) throw new ValidationError("No eligible published post exists for this draft and destination account.");
  return deps.engagement.createCommercialOutcome({
    organisationId: input.organisationId, draftId: input.draftId,
    publishingAttemptId: attempt.id, platform: input.platform,
    providerAccountId: account.providerAccountId, enquiries: input.enquiries,
    bookings: input.bookings, revenueMinor: input.revenueMinor,
    currency: input.currency, note: input.note?.trim() || null, createdBy: deps.actor.id,
  });
}

export { BRAND_ONLY_CONFIDENCE_CAP, BRAND_ONLY_LIMITATION, normaliseModelOutput, resolveLearningAccount, nextScheduledCollectionAt };
