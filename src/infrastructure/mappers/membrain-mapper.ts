import type {
  MembrainCategory,
  MembrainContextItem,
  MembrainEntry,
  MembrainSearchHit,
  MembrainTag,
  MembrainVersion,
} from "@/core/domain/entities/membrain";
import type {
  MembrainCategoryRow,
  MembrainContextRow,
  MembrainEntryRow,
  MembrainEntryVersionRow,
  MembrainSearchRow,
  MembrainTagRow,
} from "../supabase/database.types";

type ProfileRef = { id: string; full_name: string | null; email: string } | null;

export type EntryRowWithRelations = MembrainEntryRow & {
  membrain_categories: Pick<MembrainCategoryRow, "id" | "key" | "label"> | null;
  membrain_entry_tags: Array<{ membrain_tags: MembrainTagRow | null }> | null;
  created_by_profile: ProfileRef;
  updated_by_profile: ProfileRef;
};

export function toCategory(row: MembrainCategoryRow): MembrainCategory {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    key: row.key,
    label: row.label,
    description: row.description,
    position: row.position,
    isSystem: row.is_system,
  };
}

export function toTag(row: MembrainTagRow): MembrainTag {
  return { id: row.id, organisationId: row.organisation_id, name: row.name, slug: row.slug };
}

function toProfileRef(ref: ProfileRef) {
  return ref ? { id: ref.id, fullName: ref.full_name, email: ref.email } : null;
}

export function toEntry(row: EntryRowWithRelations): MembrainEntry {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    categoryId: row.category_id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    status: row.status,
    source: row.source,
    sourceUrl: row.source_url,
    importance: row.importance,
    version: row.version,
    retrievalCount: row.retrieval_count,
    lastRetrievedAt: row.last_retrieved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    category: row.membrain_categories
      ? { id: row.membrain_categories.id, key: row.membrain_categories.key, label: row.membrain_categories.label }
      : null,
    tags: (row.membrain_entry_tags ?? [])
      .map((link) => link.membrain_tags)
      .filter((tag): tag is MembrainTagRow => tag !== null)
      .map(toTag),
    createdBy: toProfileRef(row.created_by_profile),
    updatedBy: toProfileRef(row.updated_by_profile),
  };
}

export function toSearchHit(row: MembrainSearchRow): MembrainSearchHit {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    importance: row.importance,
    categoryId: row.category_id,
    version: row.version,
    updatedAt: row.updated_at,
    rank: row.rank,
    headline: row.headline ?? "",
  };
}

export function toVersion(
  row: MembrainEntryVersionRow & { changed_by_profile: ProfileRef },
): MembrainVersion {
  return {
    id: row.id,
    entryId: row.entry_id,
    version: row.version,
    title: row.title,
    summary: row.summary,
    body: row.body,
    importance: row.importance,
    status: row.status,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
    changedBy: toProfileRef(row.changed_by_profile),
  };
}

export function toContextItem(row: MembrainContextRow): MembrainContextItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    importance: row.importance,
    categoryKey: row.category_key,
    categoryLabel: row.category_label,
    version: row.version,
    updatedAt: row.updated_at,
  };
}
