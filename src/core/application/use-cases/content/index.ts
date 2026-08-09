import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import { canWriteContent } from "@/core/domain/entities/identity";
import {
  isContentDraftLocked,
  type ContentDraft,
  type ContentDraftVersion,
  type ContentGenerationRequest,
  type ContentOverview,
} from "@/core/domain/entities/content";
import type { ContentRepository } from "@/core/application/ports/content-port";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import {
  createDraftSchema,
  createGenerationRequestSchema,
  listDraftsSchema,
  updateDraftSchema,
} from "@/core/application/dto/content-dto";
import { retrieveContext } from "@/core/application/use-cases/membrain";

interface ContentDeps {
  actor: Actor;
  content: ContentRepository;
  membrain: MembrainRepository;
  organisations: OrganisationRepository;
}

const OVERVIEW_RECENT_LIMIT = 8;

async function requireRole(
  deps: ContentDeps,
  organisationId: string,
  check: (actor: Actor, role: OrganisationRole | null) => boolean,
): Promise<void> {
  if (deps.actor.isPlatformAdmin) return;
  const role = await deps.organisations.viewerRole(organisationId);
  if (!check(deps.actor, role)) {
    throw new ForbiddenError("You do not have permission to do that in Content Studio.");
  }
}

const blank = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export async function listDrafts(deps: ContentDeps, raw: unknown): Promise<ContentDraft[]> {
  const parsed = listDraftsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That draft list request could not be understood.");
  return deps.content.listDrafts(parsed.data);
}

export async function getDraft(deps: ContentDeps, organisationId: string, draftId: string): Promise<ContentDraft> {
  const draft = await deps.content.findDraft(organisationId, draftId);
  if (!draft) throw new NotFoundError("Draft");
  return draft;
}

export async function listDraftVersions(
  deps: ContentDeps,
  organisationId: string,
  draftId: string,
): Promise<ContentDraftVersion[]> {
  return deps.content.listVersions(organisationId, draftId);
}

export async function getLatestGenerationRequest(
  deps: ContentDeps,
  organisationId: string,
  draftId: string,
): Promise<ContentGenerationRequest | null> {
  return deps.content.getLatestGenerationRequest(organisationId, draftId);
}

export async function createDraft(deps: ContentDeps, raw: unknown): Promise<ContentDraft> {
  const parsed = createDraftSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the draft below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  await requireRole(deps, input.organisationId, canWriteContent);

  return deps.content.createDraft({
    organisationId: input.organisationId,
    title: input.title.trim(),
    contentType: input.contentType,
    categoryId: blank(input.categoryId),
    campaignId: blank(input.campaignId),
    summary: blank(input.summary),
    body: input.body?.trim() ?? "",
    createdBy: deps.actor.id,

    // Sprint 2 features
    dueAt: blank(input.dueAt),
    reviewerIds: input.reviewerIds ?? [],

    // Sprint 4 features
    priority: input.priority,
    reviewDeadline: blank(input.reviewDeadline),

    // Sprint 5 features
    hashtags: input.hashtags ?? [],
  });
}

export async function updateDraft(deps: ContentDeps, raw: unknown): Promise<ContentDraft> {
  const parsed = updateDraftSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the draft below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  await requireRole(deps, input.organisationId, canWriteContent);

  const existing = await deps.content.findDraft(input.organisationId, input.id);
  if (!existing) throw new NotFoundError("Draft");

  if (isContentDraftLocked(existing.status)) {
    throw new ValidationError(
      "This draft is locked because it has already been approved or rejected. A Lead must reopen it before it can be edited.",
    );
  }

  const draft = await deps.content.updateDraft(input.id, {
    organisationId: input.organisationId,
    title: input.title.trim(),
    contentType: input.contentType,
    categoryId: blank(input.categoryId),
    campaignId: blank(input.campaignId),
    summary: blank(input.summary),
    body: input.body?.trim() ?? "",
    updatedBy: deps.actor.id,

    // Sprint 2 features
    dueAt: blank(input.dueAt),
    reviewerIds: input.reviewerIds ?? [],

    // Sprint 4 features
    priority: input.priority,
    reviewDeadline: blank(input.reviewDeadline),

    // Sprint 5 features
    hashtags: input.hashtags ?? [],
  });

  // The database writes the version row; the reason for the change is a human
  // artefact and is attached afterwards, only when the content actually moved.
  const changeSummary = blank(input.changeSummary);
  if (changeSummary && draft.version > existing.version) {
    await deps.content.annotateLatestVersion(draft.id, changeSummary);
  }

  return draft;
}

/**
 * Assembles a creative brief plus a MemBrain context pack into a structured
 * request and marks the draft ready for Awo (see the migration's decision
 * note). No generation happens here or anywhere in this codebase — Genesis
 * prepares work, Awo performs AI generation, in a future sprint.
 */
export async function createGenerationRequest(
  deps: ContentDeps,
  raw: unknown,
): Promise<ContentGenerationRequest> {
  const parsed = createGenerationRequestSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the request below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  await requireRole(deps, input.organisationId, canWriteContent);

  const draft = await deps.content.findDraft(input.organisationId, input.draftId);
  if (!draft) throw new NotFoundError("Draft");

  const query = [input.brief, input.targetAudience, input.tone].filter((part) => part && part.trim()).join(" — ");

  const pack = await retrieveContext(
    { actor: deps.actor, membrain: deps.membrain, organisations: deps.organisations },
    { organisationId: input.organisationId, query, limit: 12, maxCharacters: 24000, recordUsage: false },
  );

  return deps.content.createGenerationRequest({
    organisationId: input.organisationId,
    draftId: input.draftId,
    brief: input.brief.trim(),
    targetAudience: blank(input.targetAudience),
    tone: blank(input.tone),
    contentPillarCategoryId: blank(input.contentPillarCategoryId),
    memBrainContextPrompt: pack.prompt,
    memBrainEntryCount: pack.items.length,
    memBrainEstimatedTokens: pack.estimatedTokens,
    requestedBy: deps.actor.id,
  });
}

export async function getContentOverview(deps: ContentDeps, organisationId: string): Promise<ContentOverview> {
  const [byStatus, recentDrafts] = await Promise.all([
    deps.content.countDraftsByStatus(organisationId),
    deps.content.listDrafts({ organisationId, limit: OVERVIEW_RECENT_LIMIT, offset: 0 }),
  ]);

  const totalDrafts = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  return { totalDrafts, byStatus, recentDrafts };
}

export async function scheduleDraft(
  deps: ContentDeps,
  organisationId: string,
  draftId: string,
  raw: { scheduledAt: string; platform: string; timezone: string }
): Promise<ContentDraft> {
  await requireRole(deps, organisationId, canWriteContent);
  const existing = await deps.content.findDraft(organisationId, draftId);
  if (!existing) throw new NotFoundError("Draft");
  if (existing.status !== "approved" && existing.status !== "scheduled") {
    throw new ValidationError("Only approved content can be scheduled.");
  }
  return deps.content.scheduleDraft(organisationId, draftId, {
    ...raw,
    updatedBy: deps.actor.id,
  });
}

export async function publishDraft(
  deps: ContentDeps,
  organisationId: string,
  draftId: string
): Promise<ContentDraft> {
  await requireRole(deps, organisationId, canWriteContent);
  const existing = await deps.content.findDraft(organisationId, draftId);
  if (!existing) throw new NotFoundError("Draft");
  if (existing.status !== "approved" && existing.status !== "scheduled" && existing.status !== "failed") {
    throw new ValidationError("Only approved, scheduled, or failed content can be published.");
  }
  // Transition to 'publishing' as requested by the workflow queue.
  return deps.content.updateStatus(organisationId, draftId, "publishing", deps.actor.id);
}

export async function archiveDraft(
  deps: ContentDeps,
  organisationId: string,
  draftId: string
): Promise<ContentDraft> {
  await requireRole(deps, organisationId, canWriteContent);
  const existing = await deps.content.findDraft(organisationId, draftId);
  if (!existing) throw new NotFoundError("Draft");
  return deps.content.updateStatus(organisationId, draftId, "archived", deps.actor.id);
}

export async function duplicateDraft(
  deps: ContentDeps,
  organisationId: string,
  draftId: string
): Promise<ContentDraft> {
  await requireRole(deps, organisationId, canWriteContent);
  const existing = await deps.content.findDraft(organisationId, draftId);
  if (!existing) throw new NotFoundError("Draft");
  return deps.content.createDraft({
    organisationId,
    title: `${existing.title} (Copy)`,
    contentType: existing.contentType,
    categoryId: existing.category?.id ?? null,
    campaignId: existing.campaign?.id ?? null,
    summary: existing.summary,
    body: existing.body,
    createdBy: deps.actor.id,
    dueAt: existing.dueAt,
    reviewerIds: existing.reviewerIds,
    priority: existing.priority,
    reviewDeadline: existing.reviewDeadline,
  });
}
