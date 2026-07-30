import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import type {
  Campaign,
  CampaignListItem,
  CampaignOverview,
  CampaignStatus,
} from "@/core/domain/entities/campaign";
import type { CampaignRepository } from "@/core/application/ports/campaign-port";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import {
  archiveCampaignSchema,
  createCampaignSchema,
  listCampaignsSchema,
  updateCampaignSchema,
} from "@/core/application/dto/campaign-dto";

interface CampaignDeps {
  actor: Actor;
  campaigns: CampaignRepository;
  content: ContentRepository;
  organisations: OrganisationRepository;
}

async function requireRole(
  deps: CampaignDeps,
  organisationId: string,
  check: (actor: Actor, role: OrganisationRole | null) => boolean,
): Promise<void> {
  if (deps.actor.isPlatformAdmin) return;
  const role = await deps.organisations.viewerRole(organisationId);
  if (!check(deps.actor, role)) {
    throw new ForbiddenError("You do not have permission to do that with campaigns.");
  }
}

const blank = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export async function listCampaigns(deps: CampaignDeps, raw: unknown): Promise<CampaignListItem[]> {
  const parsed = listCampaignsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That campaign list request could not be understood.");
  return deps.campaigns.listCampaigns(parsed.data);
}

export async function getCampaign(deps: CampaignDeps, organisationId: string, campaignId: string): Promise<Campaign> {
  const campaign = await deps.campaigns.findCampaign(organisationId, campaignId);
  if (!campaign) throw new NotFoundError("Campaign");
  return campaign;
}

export async function createCampaign(deps: CampaignDeps, raw: unknown): Promise<Campaign> {
  const parsed = createCampaignSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the campaign below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  await requireRole(deps, input.organisationId, canWriteContent);

  return deps.campaigns.createCampaign({
    organisationId: input.organisationId,
    name: input.name.trim(),
    description: blank(input.description),
    objective: blank(input.objective),
    targetAudience: blank(input.targetAudience),
    primaryCTA: blank(input.primaryCTA),
    startDate: blank(input.startDate),
    endDate: blank(input.endDate),
    status: input.status,
    platforms: input.platforms,
    successMetric: blank(input.successMetric),
    createdBy: deps.actor.id,
  });
}

export async function updateCampaign(deps: CampaignDeps, raw: unknown): Promise<Campaign> {
  const parsed = updateCampaignSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the campaign below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;

  // Archiving is a lead-only decision made through archiveCampaign, not a
  // status value a Contributor can reach through the general edit form —
  // this is deliberately stricter than MemBrain's entry-form precedent,
  // which lets "archived" through its own canWriteContent-gated update path
  // with no equivalent check.
  if (input.status === "archived") {
    throw new ValidationError("Use the archive action to archive a campaign.", { status: ["Use Archive instead."] });
  }

  await requireRole(deps, input.organisationId, canWriteContent);

  const existing = await deps.campaigns.findCampaign(input.organisationId, input.id);
  if (!existing) throw new NotFoundError("Campaign");

  return deps.campaigns.updateCampaign(input.id, {
    organisationId: input.organisationId,
    name: input.name.trim(),
    description: blank(input.description),
    objective: blank(input.objective),
    targetAudience: blank(input.targetAudience),
    primaryCTA: blank(input.primaryCTA),
    startDate: blank(input.startDate),
    endDate: blank(input.endDate),
    status: input.status,
    platforms: input.platforms,
    successMetric: blank(input.successMetric),
    updatedBy: deps.actor.id,
  });
}

/**
 * Lead-only, exactly like MemBrain's archive-an-entry rule — a campaign's
 * lifecycle end is an account-ownership decision, not an everyday edit.
 */
export async function archiveCampaign(deps: CampaignDeps, raw: unknown): Promise<Campaign> {
  const parsed = archiveCampaignSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That campaign could not be identified.");

  await requireRole(deps, parsed.data.organisationId, canEditOrganisation);

  const existing = await deps.campaigns.findCampaign(parsed.data.organisationId, parsed.data.campaignId);
  if (!existing) throw new NotFoundError("Campaign");

  return deps.campaigns.archiveCampaign(parsed.data.campaignId, {
    organisationId: parsed.data.organisationId,
    updatedBy: deps.actor.id,
  });
}

/**
 * Powers the campaign detail page: the campaign record plus how its linked
 * drafts break down by status. Reuses ContentRepository.countDraftsByStatus
 * (already built for Content Studio's own overview) scoped to this campaign,
 * rather than adding a second counting mechanism.
 */
export async function getCampaignOverview(
  deps: CampaignDeps,
  organisationId: string,
  campaignId: string,
): Promise<CampaignOverview> {
  const campaign = await getCampaign(deps, organisationId, campaignId);
  const byStatus = await deps.content.countDraftsByStatus(organisationId, campaignId);

  return {
    campaign,
    draftCounts: {
      draft: byStatus.draft,
      needsReview: byStatus.needs_review,
      approved: byStatus.approved,
      total: byStatus.draft + byStatus.needs_review + byStatus.approved,
    },
  };
}

export async function countCampaignsByStatus(
  deps: CampaignDeps,
  organisationId: string,
): Promise<Record<CampaignStatus, number>> {
  return deps.campaigns.countCampaignsByStatus(organisationId);
}
