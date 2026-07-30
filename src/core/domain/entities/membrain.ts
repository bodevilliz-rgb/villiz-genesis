export type MembrainStatus = "draft" | "active" | "archived";

export type MembrainSource =
  | "manual"
  | "client_brief"
  | "discovery_call"
  | "performance_insight"
  | "competitor_research"
  | "published_asset";

export interface MembrainCategory {
  id: string;
  organisationId: string;
  key: string;
  label: string;
  description: string | null;
  position: number;
  isSystem: boolean;
}

export interface MembrainTag {
  id: string;
  organisationId: string;
  name: string;
  slug: string;
}

export interface MembrainEntry {
  id: string;
  organisationId: string;
  categoryId: string | null;
  title: string;
  summary: string | null;
  body: string;
  status: MembrainStatus;
  source: MembrainSource;
  sourceUrl: string | null;
  importance: number;
  version: number;
  retrievalCount: number;
  lastRetrievedAt: string | null;
  createdAt: string;
  updatedAt: string;
  category: Pick<MembrainCategory, "id" | "key" | "label"> | null;
  tags: MembrainTag[];
  createdBy: { id: string; fullName: string | null; email: string } | null;
  updatedBy: { id: string; fullName: string | null; email: string } | null;
}

/** Search projection — deliberately lighter than a full entry. */
export interface MembrainSearchHit {
  id: string;
  title: string;
  summary: string | null;
  status: MembrainStatus;
  importance: number;
  categoryId: string | null;
  version: number;
  updatedAt: string;
  rank: number;
  /** Contains <mark> tags from ts_headline. Rendered as escaped, marked text. */
  headline: string;
}

export interface MembrainSearchResult {
  hits: MembrainSearchHit[];
  total: number;
}

export interface MembrainVersion {
  id: string;
  entryId: string;
  version: number;
  title: string;
  summary: string | null;
  body: string;
  importance: number;
  status: MembrainStatus;
  changeSummary: string | null;
  createdAt: string;
  changedBy: { id: string; fullName: string | null; email: string } | null;
}

/** A single knowledge fragment selected for an AI prompt. */
export interface MembrainContextItem {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  importance: number;
  categoryKey: string | null;
  categoryLabel: string | null;
  version: number;
  updatedAt: string;
}

export interface MembrainContextPack {
  organisationId: string;
  query: string | null;
  items: MembrainContextItem[];
  /** Prompt-ready markdown, already trimmed to the character budget. */
  prompt: string;
  estimatedTokens: number;
  truncated: boolean;
}

export const MEMBRAIN_STATUS_LABELS: Record<MembrainStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

export const MEMBRAIN_SOURCE_LABELS: Record<MembrainSource, string> = {
  manual: "Written by the team",
  client_brief: "Client brief",
  discovery_call: "Discovery call",
  performance_insight: "Performance insight",
  competitor_research: "Competitor research",
  published_asset: "Learned from a published asset",
};

export const IMPORTANCE_LABELS: Record<number, string> = {
  1: "Background",
  2: "Useful",
  3: "Standard",
  4: "Important",
  5: "Non-negotiable",
};

/**
 * Importance 4+ is always injected into AI context regardless of query match.
 * Encoded here so the rule is stated once and shown in the UI truthfully.
 */
export const ALWAYS_IN_CONTEXT_THRESHOLD = 4;

export function importanceLabel(value: number): string {
  return IMPORTANCE_LABELS[value] ?? "Standard";
}
