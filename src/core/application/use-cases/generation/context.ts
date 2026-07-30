import { NotFoundError } from "@/core/domain/errors";
import type { Actor } from "@/core/domain/entities/identity";
import type {
  BrandContext,
  CampaignContext,
  DraftContext,
  GenerationContext,
  OrganisationProfile,
} from "@/core/domain/entities/generation";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { MembrainOverview, MembrainOverviewGroup } from "@/core/application/use-cases/membrain";

interface ContextEngineDeps {
  actor: Actor;
  organisations: OrganisationRepository;
  campaigns: CampaignRepository;
  content: ContentRepository;
}

/**
 * Maps GenerationContext's six brand fields onto MemBrain's existing
 * per-organisation taxonomy keys (see the readiness taxonomy migration) —
 * the same six categories readiness.ts already scores, not a second
 * vocabulary.
 */
const BRAND_CATEGORY_KEYS = {
  brandDescription: "brand_description",
  brandVoice: "brand_voice",
  targetAudience: "audience",
  contentPillars: "content_pillars",
  productsAndServices: "offering",
  restrictions: "guidelines",
} as const;

/** Active entries only — a draft or archived entry isn't trusted knowledge (see readiness.ts's own rule). */
function activeBodiesForCategory(groups: MembrainOverviewGroup[], categoryKey: string): string[] {
  const group = groups.find((g) => g.category.key === categoryKey);
  if (!group) return [];
  return group.entries.filter((entry) => entry.status === "active").map((entry) => entry.body);
}

/**
 * Assembles the complete Generation Context Pack: organisation, campaign (if
 * any), brand knowledge, and the draft itself — structured data only, no
 * prompt text.
 *
 * Takes an already-fetched MembrainOverview rather than querying MemBrain
 * itself, so the orchestrator (getGenerationReadiness) can fetch it once and
 * reuse it here and in the Knowledge Resolver — a second, redundant MemBrain
 * read for the same page load would be exactly the kind of duplicated work
 * this sprint's "no duplicated business logic" requirement rules out.
 */
export async function buildGenerationContext(
  deps: ContextEngineDeps,
  organisationId: string,
  draftId: string,
  membrainOverview: MembrainOverview,
): Promise<GenerationContext> {
  const [organisation, draft] = await Promise.all([
    deps.organisations.findById(organisationId),
    deps.content.findDraft(organisationId, draftId),
  ]);

  if (!organisation) throw new NotFoundError("Organisation");
  if (!draft) throw new NotFoundError("Draft");

  const campaign = draft.campaign ? await deps.campaigns.findCampaign(organisationId, draft.campaign.id) : null;

  const organisationProfile: OrganisationProfile = {
    id: organisation.id,
    name: organisation.name,
    industry: organisation.industry,
    websiteUrl: organisation.websiteUrl,
  };

  const campaignContext: CampaignContext | null = campaign
    ? {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        targetAudience: campaign.targetAudience,
        primaryCTA: campaign.primaryCTA,
        platforms: campaign.platforms,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        status: campaign.status,
      }
    : null;

  const brand: BrandContext = {
    brandDescription: activeBodiesForCategory(membrainOverview.groups, BRAND_CATEGORY_KEYS.brandDescription),
    brandVoice: activeBodiesForCategory(membrainOverview.groups, BRAND_CATEGORY_KEYS.brandVoice),
    targetAudience: activeBodiesForCategory(membrainOverview.groups, BRAND_CATEGORY_KEYS.targetAudience),
    contentPillars: activeBodiesForCategory(membrainOverview.groups, BRAND_CATEGORY_KEYS.contentPillars),
    productsAndServices: activeBodiesForCategory(membrainOverview.groups, BRAND_CATEGORY_KEYS.productsAndServices),
    restrictions: activeBodiesForCategory(membrainOverview.groups, BRAND_CATEGORY_KEYS.restrictions),
  };

  const draftContext: DraftContext = {
    id: draft.id,
    contentType: draft.contentType,
    status: draft.status,
    title: draft.title,
    body: draft.body,
    summary: draft.summary,
    category: draft.category,
    version: draft.version,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };

  return {
    organisation: organisationProfile,
    campaign: campaignContext,
    brand,
    draft: draftContext,
    requestedBy: { id: deps.actor.id, fullName: deps.actor.fullName, email: deps.actor.email },
    assembledAt: new Date().toISOString(),
  };
}
