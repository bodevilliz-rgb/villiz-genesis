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

export interface MembrainEntryWriteModel {
  organisationId: string;
  title: string;
  summary: string | null;
  body: string;
  categoryId: string | null;
  status: MembrainEntry["status"];
  source: MembrainEntry["source"];
  sourceUrl: string | null;
  importance: number;
}

export interface MembrainRepository {
  listCategories(organisationId: string): Promise<MembrainCategory[]>;
  listTags(organisationId: string): Promise<MembrainTag[]>;
  /** Resolves tag names to ids, creating any that do not yet exist. */
  ensureTags(organisationId: string, names: string[]): Promise<MembrainTag[]>;

  search(input: SearchEntriesInput): Promise<MembrainSearchResult>;
  findEntry(organisationId: string, entryId: string): Promise<MembrainEntry | null>;
  listRecent(organisationId: string, limit: number): Promise<MembrainEntry[]>;
  countEntries(organisationId: string): Promise<number>;

  createEntry(input: MembrainEntryWriteModel & { createdBy: string }): Promise<MembrainEntry>;
  updateEntry(
    entryId: string,
    input: MembrainEntryWriteModel & { updatedBy: string },
  ): Promise<MembrainEntry>;
  setEntryTags(entryId: string, tagIds: string[]): Promise<void>;
  annotateLatestVersion(entryId: string, changeSummary: string): Promise<void>;

  listVersions(organisationId: string, entryId: string): Promise<MembrainVersion[]>;
  findVersion(organisationId: string, entryId: string, version: number): Promise<MembrainVersion | null>;

  retrieveContext(input: {
    organisationId: string;
    query: string | null;
    limit: number;
  }): Promise<MembrainContextItem[]>;
  markRetrieved(entryIds: string[]): Promise<void>;
  recordAiUsage(input: {
    organisationId: string;
    profileId: string | null;
    feature: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void>;

  /** MemBrain entry version history across every visible organisation, for the Team Activity feed. */
  listRecentActivityForActor(limit: number): Promise<DashboardActivityItem[]>;
}
