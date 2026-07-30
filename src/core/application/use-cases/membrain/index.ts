import { ForbiddenError, NotFoundError, ValidationError } from "@/core/domain/errors";
import type { Actor, OrganisationRole } from "@/core/domain/entities/identity";
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import type {
  MembrainCategory,
  MembrainContextPack,
  MembrainEntry,
  MembrainSearchResult,
  MembrainTag,
  MembrainVersion,
} from "@/core/domain/entities/membrain";
import type { MembrainRepository } from "@/core/application/ports/membrain-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import {
  archiveEntrySchema,
  createEntrySchema,
  restoreVersionSchema,
  searchEntriesSchema,
  retrieveContextSchema,
  updateEntrySchema,
} from "@/core/application/dto/membrain-dto";
import { buildContextPack } from "./context-pack";
import { computeMembrainReadiness, type MembrainReadiness } from "./readiness";

interface MembrainDeps {
  actor: Actor;
  membrain: MembrainRepository;
  organisations: OrganisationRepository;
}

/**
 * A generous but bounded fetch for "every entry this organisation has" —
 * used by the overview page's category grouping and by readiness, neither
 * of which paginate. Reuses `listRecent`; no new repository method needed.
 */
const OVERVIEW_ENTRY_LIMIT = 500;

async function requireRole(
  deps: MembrainDeps,
  organisationId: string,
  check: (actor: Actor, role: OrganisationRole | null) => boolean,
): Promise<void> {
  if (deps.actor.isPlatformAdmin) return;
  const role = await deps.organisations.viewerRole(organisationId);
  if (!check(deps.actor, role)) {
    throw new ForbiddenError("You do not have permission to do that in MemBrain.");
  }
}

const blank = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export async function listCategories(deps: MembrainDeps, organisationId: string): Promise<MembrainCategory[]> {
  return deps.membrain.listCategories(organisationId);
}

export async function listTags(deps: MembrainDeps, organisationId: string): Promise<MembrainTag[]> {
  return deps.membrain.listTags(organisationId);
}

export async function searchMembrain(deps: MembrainDeps, raw: unknown): Promise<MembrainSearchResult> {
  const parsed = searchEntriesSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That search could not be understood.");
  return deps.membrain.search(parsed.data);
}

export async function getEntry(
  deps: MembrainDeps,
  organisationId: string,
  entryId: string,
): Promise<MembrainEntry> {
  const entry = await deps.membrain.findEntry(organisationId, entryId);
  if (!entry) throw new NotFoundError("Knowledge entry");
  return entry;
}

export async function listEntryVersions(
  deps: MembrainDeps,
  organisationId: string,
  entryId: string,
): Promise<MembrainVersion[]> {
  return deps.membrain.listVersions(organisationId, entryId);
}

export async function createEntry(deps: MembrainDeps, raw: unknown): Promise<MembrainEntry> {
  const parsed = createEntrySchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the entry below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  await requireRole(deps, input.organisationId, canWriteContent);

  const entry = await deps.membrain.createEntry({
    organisationId: input.organisationId,
    title: input.title.trim(),
    summary: blank(input.summary),
    body: input.body.trim(),
    categoryId: blank(input.categoryId),
    status: input.status,
    source: input.source,
    sourceUrl: blank(input.sourceUrl),
    importance: input.importance,
    createdBy: deps.actor.id,
  });

  if (input.tags.length > 0) {
    const tags = await deps.membrain.ensureTags(input.organisationId, input.tags);
    await deps.membrain.setEntryTags(entry.id, tags.map((t) => t.id));
  }

  return entry;
}

export async function updateEntry(deps: MembrainDeps, raw: unknown): Promise<MembrainEntry> {
  const parsed = updateEntrySchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the entry below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  await requireRole(deps, input.organisationId, canWriteContent);

  const existing = await deps.membrain.findEntry(input.organisationId, input.id);
  if (!existing) throw new NotFoundError("Knowledge entry");

  const entry = await deps.membrain.updateEntry(input.id, {
    organisationId: input.organisationId,
    title: input.title.trim(),
    summary: blank(input.summary),
    body: input.body.trim(),
    categoryId: blank(input.categoryId),
    status: input.status,
    source: input.source,
    sourceUrl: blank(input.sourceUrl),
    importance: input.importance,
    updatedBy: deps.actor.id,
  });

  const tags = await deps.membrain.ensureTags(input.organisationId, input.tags);
  await deps.membrain.setEntryTags(entry.id, tags.map((t) => t.id));

  // The database writes the version row; the reason for the change is a human
  // artefact and is attached afterwards, only when the content actually moved.
  const changeSummary = blank(input.changeSummary);
  if (changeSummary && entry.version > existing.version) {
    await deps.membrain.annotateLatestVersion(entry.id, changeSummary);
  }

  return entry;
}

export async function archiveEntry(deps: MembrainDeps, raw: unknown): Promise<MembrainEntry> {
  const parsed = archiveEntrySchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That entry could not be identified.");

  // Archiving is a lead-only action — creating and editing is open to
  // contributors, but withdrawing knowledge from AI context is not.
  await requireRole(deps, parsed.data.organisationId, canEditOrganisation);

  const existing = await deps.membrain.findEntry(parsed.data.organisationId, parsed.data.entryId);
  if (!existing) throw new NotFoundError("Knowledge entry");

  return deps.membrain.updateEntry(existing.id, {
    organisationId: existing.organisationId,
    title: existing.title,
    summary: existing.summary,
    body: existing.body,
    categoryId: existing.categoryId,
    status: "archived",
    source: existing.source,
    sourceUrl: existing.sourceUrl,
    importance: existing.importance,
    updatedBy: deps.actor.id,
  });
}

/**
 * Restore does NOT rewrite history. It reads an old version and writes it
 * forward as a new one, so the audit trail records that a restore happened.
 */
export async function restoreVersion(deps: MembrainDeps, raw: unknown): Promise<MembrainEntry> {
  const parsed = restoreVersionSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That version could not be identified.");

  const { organisationId, entryId, version } = parsed.data;
  const [current, snapshot] = await Promise.all([
    deps.membrain.findEntry(organisationId, entryId),
    deps.membrain.findVersion(organisationId, entryId, version),
  ]);

  if (!current) throw new NotFoundError("Knowledge entry");
  if (!snapshot) throw new NotFoundError(`Version ${version}`);

  const entry = await deps.membrain.updateEntry(entryId, {
    organisationId,
    title: snapshot.title,
    summary: snapshot.summary,
    body: snapshot.body,
    categoryId: current.categoryId,
    status: snapshot.status,
    source: current.source,
    sourceUrl: current.sourceUrl,
    importance: snapshot.importance,
    updatedBy: deps.actor.id,
  });

  if (entry.version > current.version) {
    await deps.membrain.annotateLatestVersion(entry.id, `Restored from version ${version}`);
  }

  return entry;
}

/**
 * The retrieval surface every AI feature in Project Genesis will call.
 * Sprint 2 (Content Studio) consumes this; it is complete and usable today.
 */
export async function retrieveContext(deps: MembrainDeps, raw: unknown): Promise<MembrainContextPack> {
  const parsed = retrieveContextSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("That retrieval request could not be understood.");

  const input = parsed.data;
  const organisation = await deps.organisations.findById(input.organisationId);
  if (!organisation) throw new NotFoundError("Organisation");

  const items = await deps.membrain.retrieveContext({
    organisationId: input.organisationId,
    query: input.query?.trim() || null,
    limit: input.limit,
  });

  const pack = buildContextPack({
    organisationId: input.organisationId,
    organisationName: organisation.name,
    query: input.query?.trim() || null,
    items,
    maxCharacters: input.maxCharacters,
  });

  if (input.recordUsage && pack.items.length > 0) {
    // Telemetry must never break retrieval.
    await Promise.allSettled([
      deps.membrain.markRetrieved(pack.items.map((i) => i.id)),
      deps.membrain.recordAiUsage({
        organisationId: input.organisationId,
        profileId: deps.actor.id,
        feature: "membrain.retrieve_context",
        inputTokens: pack.estimatedTokens,
        outputTokens: 0,
      }),
    ]);
  }

  return pack;
}

export interface MembrainOverviewGroup {
  category: MembrainCategory;
  entries: MembrainEntry[];
}

export interface MembrainOverview {
  /** Excludes archived — matches countEntries' own definition of "in use". */
  totalEntries: number;
  categories: MembrainCategory[];
  groups: MembrainOverviewGroup[];
  /** Entries with no category assigned — shown separately, never silently dropped. */
  uncategorised: MembrainEntry[];
  readiness: MembrainReadiness;
}

/**
 * Powers the MemBrain overview page: entries grouped by category, a total
 * count, and the readiness calculation. Reuses `listRecent` (bounded by
 * OVERVIEW_ENTRY_LIMIT) rather than adding a new unpaginated repository
 * method — an organisation's knowledge base is not expected to exceed that
 * in this sprint, and `countEntries` still reports the true total regardless.
 */
export async function getMembrainOverview(deps: MembrainDeps, organisationId: string): Promise<MembrainOverview> {
  const [categories, entries, totalEntries] = await Promise.all([
    deps.membrain.listCategories(organisationId),
    deps.membrain.listRecent(organisationId, OVERVIEW_ENTRY_LIMIT),
    deps.membrain.countEntries(organisationId),
  ]);

  const visible = entries.filter((entry) => entry.status !== "archived");

  const groups: MembrainOverviewGroup[] = categories.map((category) => ({
    category,
    entries: visible.filter((entry) => entry.category?.id === category.id),
  }));

  const uncategorised = visible.filter((entry) => !entry.category);

  const readiness = computeMembrainReadiness(
    visible.map((entry) => ({ categoryKey: entry.category?.key ?? null, status: entry.status })),
  );

  return { totalEntries, categories, groups, uncategorised, readiness };
}
