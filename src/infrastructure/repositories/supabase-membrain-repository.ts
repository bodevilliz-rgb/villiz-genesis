import "server-only";
import type {
  MembrainEntryWriteModel,
  MembrainRepository,
} from "@/core/application/ports/membrain-port";
import type {
  MembrainCategory,
  MembrainContextItem,
  MembrainEntry,
  MembrainSearchResult,
  MembrainTag,
  MembrainVersion,
} from "@/core/domain/entities/membrain";
import type { SearchEntriesInput } from "@/core/application/dto/membrain-dto";
import type { DashboardActivityItem } from "@/core/domain/entities/dashboard";
import type { GenesisClient } from "../supabase/server-client";
import {
  toCategory,
  toContextItem,
  toEntry,
  toSearchHit,
  toTag,
  toVersion,
  type EntryRowWithRelations,
} from "../mappers/membrain-mapper";
import { translateError, unwrap } from "./errors";
import { slugify } from "@/lib/slug";

/**
 * Explicit relationship hints (`!fkey`) are required because `profiles` is
 * referenced twice from membrain_entries. Without them PostgREST cannot decide
 * which foreign key to traverse and the request fails at runtime.
 */
const ENTRY_SELECT = `
  *,
  membrain_categories(id, key, label),
  membrain_entry_tags(membrain_tags(*)),
  created_by_profile:profiles!membrain_entries_created_by_fkey(id, full_name, email),
  updated_by_profile:profiles!membrain_entries_updated_by_fkey(id, full_name, email)
`;

const VERSION_SELECT = `
  *,
  changed_by_profile:profiles!membrain_entry_versions_changed_by_fkey(id, full_name, email)
`;

export class SupabaseMembrainRepository implements MembrainRepository {
  constructor(private readonly client: GenesisClient) {}

  async listCategories(organisationId: string): Promise<MembrainCategory[]> {
    const { data, error } = await this.client
      .from("membrain_categories")
      .select("*")
      .eq("organisation_id", organisationId)
      .order("position", { ascending: true });

    if (error) translateError(error, "Categories");
    return (data ?? []).map(toCategory);
  }

  async listTags(organisationId: string): Promise<MembrainTag[]> {
    const { data, error } = await this.client
      .from("membrain_tags")
      .select("*")
      .eq("organisation_id", organisationId)
      .order("name", { ascending: true });

    if (error) translateError(error, "Tags");
    return (data ?? []).map(toTag);
  }

  /**
   * Tag resolution is a single upsert rather than read-then-write, which makes
   * it safe when two employees save entries with the same new tag at once.
   */
  async ensureTags(organisationId: string, names: string[]): Promise<MembrainTag[]> {
    const unique = new Map<string, string>();
    for (const name of names) {
      const trimmed = name.trim();
      const slug = slugify(trimmed);
      if (trimmed && slug) unique.set(slug, trimmed);
    }
    if (unique.size === 0) return [];

    const payload = [...unique.entries()].map(([slug, name]) => ({
      organisation_id: organisationId,
      name,
      slug,
    }));

    const { error } = await this.client
      .from("membrain_tags")
      .upsert(payload, { onConflict: "organisation_id,slug", ignoreDuplicates: true });

    if (error) translateError(error, "Tag creation");

    const { data, error: readError } = await this.client
      .from("membrain_tags")
      .select("*")
      .eq("organisation_id", organisationId)
      .in("slug", [...unique.keys()]);

    if (readError) translateError(readError, "Tag lookup");
    return (data ?? []).map(toTag);
  }

  async search(input: SearchEntriesInput): Promise<MembrainSearchResult> {
    const { data, error } = await this.client.rpc("membrain_search", {
      p_organisation_id: input.organisationId,
      p_query: input.query?.trim() || null,
      p_category_ids: input.categoryIds?.length ? input.categoryIds : null,
      p_tag_ids: input.tagIds?.length ? input.tagIds : null,
      p_statuses: input.statuses?.length ? input.statuses : null,
      p_limit: input.limit,
      p_offset: input.offset,
    });

    if (error) translateError(error, "MemBrain search");

    const rows = data ?? [];
    return {
      hits: rows.map(toSearchHit),
      total: rows.length > 0 ? Number(rows[0]!.total_count) : 0,
    };
  }

  async findEntry(organisationId: string, entryId: string): Promise<MembrainEntry | null> {
    const { data, error } = await this.client
      .from("membrain_entries")
      .select(ENTRY_SELECT)
      .eq("organisation_id", organisationId)
      .eq("id", entryId)
      .maybeSingle();

    if (error) translateError(error, "Knowledge entry");
    return data ? toEntry(data as unknown as EntryRowWithRelations) : null;
  }

  async listRecent(organisationId: string, limit: number): Promise<MembrainEntry[]> {
    const { data, error } = await this.client
      .from("membrain_entries")
      .select(ENTRY_SELECT)
      .eq("organisation_id", organisationId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) translateError(error, "Recent knowledge");
    return (data ?? []).map((row) => toEntry(row as unknown as EntryRowWithRelations));
  }

  async countEntries(organisationId: string): Promise<number> {
    const { count, error } = await this.client
      .from("membrain_entries")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .neq("status", "archived");

    if (error) translateError(error, "Knowledge count");
    return count ?? 0;
  }

  async createEntry(input: MembrainEntryWriteModel & { createdBy: string }): Promise<MembrainEntry> {
    const result = await this.client
      .from("membrain_entries")
      .insert({
        organisation_id: input.organisationId,
        title: input.title,
        summary: input.summary,
        body: input.body,
        category_id: input.categoryId,
        status: input.status,
        source: input.source,
        source_url: input.sourceUrl,
        importance: input.importance,
        created_by: input.createdBy,
        updated_by: input.createdBy,
      })
      .select(ENTRY_SELECT)
      .single();

    return toEntry(unwrap(result, "Knowledge entry") as unknown as EntryRowWithRelations);
  }

  async updateEntry(
    entryId: string,
    input: MembrainEntryWriteModel & { updatedBy: string },
  ): Promise<MembrainEntry> {
    const result = await this.client
      .from("membrain_entries")
      .update({
        title: input.title,
        summary: input.summary,
        body: input.body,
        category_id: input.categoryId,
        status: input.status,
        source: input.source,
        source_url: input.sourceUrl,
        importance: input.importance,
        updated_by: input.updatedBy,
      })
      .eq("id", entryId)
      .eq("organisation_id", input.organisationId)
      .select(ENTRY_SELECT)
      .single();

    return toEntry(unwrap(result, "Knowledge entry") as unknown as EntryRowWithRelations);
  }

  async setEntryTags(entryId: string, tagIds: string[]): Promise<void> {
    const { error: clearError } = await this.client
      .from("membrain_entry_tags")
      .delete()
      .eq("entry_id", entryId);

    if (clearError) translateError(clearError, "Tag assignment");
    if (tagIds.length === 0) return;

    const { error } = await this.client
      .from("membrain_entry_tags")
      .insert(tagIds.map((tagId) => ({ entry_id: entryId, tag_id: tagId })));

    if (error) translateError(error, "Tag assignment");
  }

  /** Attaches the reason for a change to the version the trigger just wrote. */
  async annotateLatestVersion(entryId: string, changeSummary: string): Promise<void> {
    const { data, error } = await this.client
      .from("membrain_entry_versions")
      .select("id, version")
      .eq("entry_id", entryId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) translateError(error, "Version history");
    if (!data) return;

    const { error: updateError } = await this.client
      .from("membrain_entry_versions")
      .update({ change_summary: changeSummary })
      .eq("id", data.id)
      .is("change_summary", null);

    if (updateError) translateError(updateError, "Version annotation");
  }

  async listVersions(organisationId: string, entryId: string): Promise<MembrainVersion[]> {
    const { data, error } = await this.client
      .from("membrain_entry_versions")
      .select(VERSION_SELECT)
      .eq("organisation_id", organisationId)
      .eq("entry_id", entryId)
      .order("version", { ascending: false });

    if (error) translateError(error, "Version history");
    return (data ?? []).map((row) => toVersion(row as never));
  }

  async findVersion(
    organisationId: string,
    entryId: string,
    version: number,
  ): Promise<MembrainVersion | null> {
    const { data, error } = await this.client
      .from("membrain_entry_versions")
      .select(VERSION_SELECT)
      .eq("organisation_id", organisationId)
      .eq("entry_id", entryId)
      .eq("version", version)
      .maybeSingle();

    if (error) translateError(error, "Version");
    return data ? toVersion(data as never) : null;
  }

  async retrieveContext(input: {
    organisationId: string;
    query: string | null;
    limit: number;
  }): Promise<MembrainContextItem[]> {
    const { data, error } = await this.client.rpc("membrain_context", {
      p_organisation_id: input.organisationId,
      p_query: input.query,
      p_limit: input.limit,
    });

    if (error) translateError(error, "MemBrain retrieval");
    return (data ?? []).map(toContextItem);
  }

  async markRetrieved(entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) return;
    const { error } = await this.client.rpc("membrain_mark_retrieved", { p_entry_ids: entryIds });
    if (error) translateError(error, "Retrieval telemetry");
  }

  async recordAiUsage(input: {
    organisationId: string;
    profileId: string | null;
    feature: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void> {
    const { error } = await this.client.from("ai_usage_events").insert({
      organisation_id: input.organisationId,
      profile_id: input.profileId,
      feature: input.feature,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
    });

    if (error) translateError(error, "AI usage telemetry");
  }

  async listRecentActivityForActor(limit: number): Promise<DashboardActivityItem[]> {
    const { data, error } = await this.client
      .from("membrain_entry_versions")
      .select(
        `id, entry_id, organisation_id, version, title, created_at,
         organisations(name),
         changed_by_profile:profiles!membrain_entry_versions_changed_by_fkey(id, full_name, email)`,
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) translateError(error, "Team activity");

    return (data ?? []).map((row): DashboardActivityItem => {
      const version = row as unknown as {
        id: string;
        entry_id: string;
        organisation_id: string;
        version: number;
        title: string;
        created_at: string;
        organisations: { name: string } | null;
        changed_by_profile: { id: string; full_name: string | null; email: string } | null;
      };
      return {
        id: version.id,
        kind: "membrain",
        organisationId: version.organisation_id,
        organisationName: version.organisations?.name ?? "Unknown account",
        entityId: version.entry_id,
        entityTitle: version.title,
        action: version.version === 1 ? "created" : "updated",
        actor: version.changed_by_profile
          ? {
              id: version.changed_by_profile.id,
              fullName: version.changed_by_profile.full_name,
              email: version.changed_by_profile.email,
            }
          : null,
        occurredAt: version.created_at,
      };
    });
  }
}
