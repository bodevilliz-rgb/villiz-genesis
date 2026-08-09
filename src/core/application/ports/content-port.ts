import type {
  ContentDraft,
  ContentDraftStatus,
  ContentDraftType,
  ContentDraftVersion,
  ContentGenerationRequest,
} from "@/core/domain/entities/content";
import type { DashboardActivityItem } from "@/core/domain/entities/dashboard";

export interface ContentDraftWriteModel {
  organisationId: string;
  title: string;
  contentType: ContentDraftType;
  categoryId: string | null;
  campaignId: string | null;
  summary: string | null;
  body: string;

  // Sprint 2 features
  dueAt: string | null;
  reviewerIds: string[];

  // Sprint 4 features
  priority: "low" | "medium" | "high";
  reviewDeadline: string | null;

  // Sprint 5 features
  hashtags?: string[];
}

export interface ContentRepository {
  listDrafts(input: {
    organisationId: string;
    query?: string;
    status?: ContentDraftStatus;
    contentType?: ContentDraftType;
    categoryId?: string;
    campaignId?: string;
    authorId?: string;
    limit: number;
    offset: number;
  }): Promise<ContentDraft[]>;

  /**
   * One count per status, always all three keys present even when zero.
   * `campaignId` narrows to one campaign's drafts — used by the campaign
   * overview page; omitted, it's the org-wide count Content Studio's own
   * overview already used.
   */
  countDraftsByStatus(organisationId: string, campaignId?: string): Promise<Record<ContentDraftStatus, number>>;

  findDraft(organisationId: string, draftId: string): Promise<ContentDraft | null>;

  createDraft(input: ContentDraftWriteModel & { createdBy: string }): Promise<ContentDraft>;
  updateDraft(draftId: string, input: ContentDraftWriteModel & { updatedBy: string }): Promise<ContentDraft>;
  scheduleDraft(
    organisationId: string,
    draftId: string,
    input: { scheduledAt: string; platform: string; timezone: string; updatedBy: string }
  ): Promise<ContentDraft>;
  updateStatus(
    organisationId: string,
    draftId: string,
    status: ContentDraftStatus,
    updatedBy: string
  ): Promise<ContentDraft>;

  /** Attaches the reason for a change to the version the trigger just wrote. */
  annotateLatestVersion(draftId: string, changeSummary: string): Promise<void>;
  listVersions(organisationId: string, draftId: string): Promise<ContentDraftVersion[]>;

  createGenerationRequest(input: {
    organisationId: string;
    draftId: string;
    brief: string;
    targetAudience: string | null;
    tone: string | null;
    contentPillarCategoryId: string | null;
    memBrainContextPrompt: string;
    memBrainEntryCount: number;
    memBrainEstimatedTokens: number;
    requestedBy: string;
  }): Promise<ContentGenerationRequest>;

  getLatestGenerationRequest(organisationId: string, draftId: string): Promise<ContentGenerationRequest | null>;

  /**
   * Cross-organisation, unlike every other query in this repository — no
   * `organisationId` filter is applied, so RLS alone decides which rows come
   * back (the same reliance `UsageRepository.forAllVisibleOrganisations`
   * already uses). Powers the Dashboard and Review Queue, both of which
   * operate across every account the actor can see, not one at a time.
   */
  listDraftsForActor(input: {
    organisationId?: string;
    campaignId?: string;
    status?: ContentDraftStatus;
    authorId?: string;
    updatedBy?: string;
    assignedReviewerId?: string;
    unassigned?: boolean;
    submittedFrom?: string;
    submittedTo?: string;
    limit: number;
  }): Promise<ContentDraft[]>;

  /** Recent content-draft version history across every visible organisation, for the Team Activity feed. */
  listRecentActivityForActor(limit: number): Promise<DashboardActivityItem[]>;
}
