/**
 * Database contract.
 *
 * GENERATED FILE — do not edit by hand.
 * Regenerate with `npm run db:types` while a database is running.
 * Verify with `npm run db:types:check`, which fails on drift.
 *
 * Two properties this file must preserve, both learned by breaking them:
 *   Row types are type aliases, not interfaces. Interfaces have no implicit
 *   index signature and therefore fail Supabase's Record<string, unknown>
 *   constraint, which silently degrades every query to `never`.
 *
 *   Foreign keys are declared. PostgREST resolves embedded selects from
 *   this metadata; an empty Relationships array turns every join into
 *   `never` and disables the compiler exactly where an isolation bug hides.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type CampaignStatusDb = "planning" | "active" | "completed" | "archived";
export type ConnectionStatusDb = "connected" | "expired" | "revoked";
export type ContentDraftAwoStatusDb = "not_requested" | "ready_for_awo";
export type ContentDraftStatusDb = "draft" | "needs_review" | "in_review" | "changes_requested" | "approved" | "rejected" | "scheduled" | "published" | "archived";
export type ContentDraftReviewActionDb =
  | "submitted"
  | "assigned"
  | "reassigned"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "reopened";
export type ContentDraftTypeDb = "social_post" | "caption" | "campaign_copy" | "email" | "blog_article" | "image_prompt" | "ad_copy" | "video_script" | "other";
export type MembrainSourceDb = "manual" | "client_brief" | "discovery_call" | "performance_insight" | "competitor_research" | "published_asset";
export type MembrainStatusDb = "draft" | "active" | "archived";
export type OrganisationRoleDb = "lead" | "contributor" | "reviewer";
export type OrganisationStatusDb = "prospect" | "active" | "paused" | "offboarded";
export type PlatformRoleDb = "owner" | "admin" | "member";
export type PostStatusDb = "idea" | "researching" | "drafting" | "in_review" | "approved" | "scheduled" | "published" | "failed" | "archived";
export type SocialPlatformDb = "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "youtube" | "pinterest" | "threads";

export type AiUsageEventRow = {
  id: number;
  organisation_id: string;
  profile_id: string | null;
  feature: string;
  input_tokens: number;
  output_tokens: number;
  occurred_at: string;
};

export type CampaignRow = {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  objective: string | null;
  target_audience: string | null;
  primary_cta: string | null;
  start_date: string | null;
  end_date: string | null;
  status: CampaignStatusDb;
  platforms: SocialPlatformDb[];
  success_metric: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentDraftRow = {
  id: string;
  organisation_id: string;
  category_id: string | null;
  campaign_id: string | null;
  title: string;
  content_type: ContentDraftTypeDb;
  summary: string | null;
  body: string;
  status: ContentDraftStatusDb;
  awo_status: ContentDraftAwoStatusDb;
  assigned_reviewer_id: string | null;
  last_review_action: ContentDraftReviewActionDb | null;
  last_review_at: string | null;
  version: number;
  scheduled_at: string | null;
  scheduled_platform: string | null;
  scheduled_timezone: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentDraftReviewRow = {
  id: string;
  draft_id: string;
  organisation_id: string;
  action: ContentDraftReviewActionDb;
  actor_id: string | null;
  assigned_reviewer_id: string | null;
  previous_status: ContentDraftStatusDb;
  new_status: ContentDraftStatusDb;
  comment: string | null;
  created_at: string;
};

export type ContentDraftVersionRow = {
  id: string;
  draft_id: string;
  organisation_id: string;
  version: number;
  title: string;
  body: string;
  category_id: string | null;
  campaign_id: string | null;
  content_type: ContentDraftTypeDb;
  status: ContentDraftStatusDb;
  change_summary: string | null;
  changed_by: string | null;
  created_at: string;
};

export type ContentGenerationRequestRow = {
  id: string;
  draft_id: string;
  organisation_id: string;
  brief: string;
  target_audience: string | null;
  tone: string | null;
  content_pillar_category_id: string | null;
  membrain_context_prompt: string;
  membrain_context_entry_count: number;
  membrain_context_estimated_tokens: number;
  requested_by: string | null;
  requested_at: string;
};

export type MediaAssetRow = {
  id: string;
  organisation_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  uploaded_by: string | null;
  created_at: string;
};

export type MembrainCategoryRow = {
  id: string;
  organisation_id: string;
  key: string;
  label: string;
  description: string | null;
  position: number;
  is_system: boolean;
  created_at: string;
};

export type MembrainEntryRow = {
  id: string;
  organisation_id: string;
  category_id: string | null;
  title: string;
  summary: string | null;
  body: string;
  status: MembrainStatusDb;
  source: MembrainSourceDb;
  source_url: string | null;
  importance: number;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  last_retrieved_at: string | null;
  retrieval_count: number;
  created_at: string;
  updated_at: string;
  search_vector: unknown | null;
};

export type MembrainEntryTagRow = {
  entry_id: string;
  tag_id: string;
};

export type MembrainEntryVersionRow = {
  id: string;
  entry_id: string;
  organisation_id: string;
  version: number;
  title: string;
  summary: string | null;
  body: string;
  category_id: string | null;
  importance: number;
  status: MembrainStatusDb;
  change_summary: string | null;
  changed_by: string | null;
  created_at: string;
};

export type MembrainTagRow = {
  id: string;
  organisation_id: string;
  name: string;
  slug: string;
  created_at: string;
};

export type OrganisationLimitsRow = {
  organisation_id: string;
  max_social_accounts: number;
  max_posts_per_week: number;
  max_storage_bytes: number;
  max_ai_tokens_per_month: number;
  max_membrain_entries: number;
  updated_at: string;
};

export type OrganisationMemberRow = {
  organisation_id: string;
  profile_id: string;
  role: OrganisationRoleDb;
  assigned_by: string | null;
  created_at: string;
};

export type OrganisationRow = {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  industry: string | null;
  website_url: string | null;
  status: OrganisationStatusDb;
  brand_colour: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  notes: string | null;
  onboarded_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlatformSettingsRow = {
  id: boolean;
  allowed_email_domains: string[];
  updated_at: string;
};

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  role: PlatformRoleDb;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduledPostRow = {
  id: string;
  organisation_id: string;
  social_account_id: string | null;
  status: PostStatusDb;
  scheduled_for: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialAccountRow = {
  id: string;
  organisation_id: string;
  platform: SocialPlatformDb;
  handle: string;
  display_name: string | null;
  external_account_id: string | null;
  status: ConnectionStatusDb;
  connected_by: string | null;
  connected_at: string;
  created_at: string;
  updated_at: string;
};

export type UsageSnapshotRow = {
  organisation_id: string | null;
  social_accounts_used: number | null;
  posts_this_week: number | null;
  storage_bytes_used: number | null;
  ai_tokens_this_month: number | null;
  membrain_entries_used: number | null;
  max_social_accounts: number | null;
  max_posts_per_week: number | null;
  max_storage_bytes: number | null;
  max_ai_tokens_per_month: number | null;
  max_membrain_entries: number | null;
};

export type MembrainContextRow = {
  id: string;
  title: string;
  summary: string;
  body: string;
  importance: number;
  category_key: string;
  category_label: string;
  version: number;
  updated_at: string;
  rank: number;
};

export type MembrainSearchRow = {
  id: string;
  title: string;
  summary: string;
  status: MembrainStatusDb;
  importance: number;
  category_id: string;
  version: number;
  updated_at: string;
  rank: number;
  headline: string;
  total_count: number;
};

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<
  Row extends Record<string, unknown>,
  Insert = Partial<Row>,
  Update = Partial<Row>,
  Relationships extends Relationship[] = [],
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

type View<Row extends Record<string, unknown>> = { Row: Row; Relationships: [] };

type Fk<Name extends string, Col extends string, Ref extends string> = {
  foreignKeyName: Name;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: ["id"];
};

export type Database = {
  public: {
    Tables: {
      ai_usage_events: Table<
        AiUsageEventRow,
        Partial<AiUsageEventRow>,
        Partial<AiUsageEventRow>,
        [
          Fk<"ai_usage_events_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"ai_usage_events_profile_id_fkey", "profile_id", "profiles">,
        ]
      >;
      campaigns: Table<
        CampaignRow,
        Partial<CampaignRow>,
        Partial<CampaignRow>,
        [
          Fk<"campaigns_created_by_fkey", "created_by", "profiles">,
          Fk<"campaigns_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"campaigns_updated_by_fkey", "updated_by", "profiles">,
        ]
      >;
      content_draft_reviews: Table<
        ContentDraftReviewRow,
        Partial<ContentDraftReviewRow>,
        Partial<ContentDraftReviewRow>,
        [
          Fk<"content_draft_reviews_actor_id_fkey", "actor_id", "profiles">,
          Fk<"content_draft_reviews_assigned_reviewer_id_fkey", "assigned_reviewer_id", "profiles">,
          Fk<"content_draft_reviews_draft_id_fkey", "draft_id", "content_drafts">,
          Fk<"content_draft_reviews_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      content_draft_versions: Table<
        ContentDraftVersionRow,
        Partial<ContentDraftVersionRow>,
        Partial<ContentDraftVersionRow>,
        [
          Fk<"content_draft_versions_changed_by_fkey", "changed_by", "profiles">,
          Fk<"content_draft_versions_draft_id_fkey", "draft_id", "content_drafts">,
          Fk<"content_draft_versions_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      content_drafts: Table<
        ContentDraftRow,
        Partial<ContentDraftRow>,
        Partial<ContentDraftRow>,
        [
          Fk<"content_drafts_assigned_reviewer_id_fkey", "assigned_reviewer_id", "profiles">,
          Fk<"content_drafts_campaign_id_fkey", "campaign_id", "campaigns">,
          Fk<"content_drafts_category_id_fkey", "category_id", "membrain_categories">,
          Fk<"content_drafts_created_by_fkey", "created_by", "profiles">,
          Fk<"content_drafts_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"content_drafts_updated_by_fkey", "updated_by", "profiles">,
        ]
      >;
      content_generation_requests: Table<
        ContentGenerationRequestRow,
        Partial<ContentGenerationRequestRow>,
        Partial<ContentGenerationRequestRow>,
        [
          Fk<"content_generation_requests_content_pillar_category_id_fkey", "content_pillar_category_id", "membrain_categories">,
          Fk<"content_generation_requests_draft_id_fkey", "draft_id", "content_drafts">,
          Fk<"content_generation_requests_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"content_generation_requests_requested_by_fkey", "requested_by", "profiles">,
        ]
      >;
      media_assets: Table<
        MediaAssetRow,
        Partial<MediaAssetRow>,
        Partial<MediaAssetRow>,
        [
          Fk<"media_assets_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"media_assets_uploaded_by_fkey", "uploaded_by", "profiles">,
        ]
      >;
      membrain_categories: Table<
        MembrainCategoryRow,
        Partial<MembrainCategoryRow>,
        Partial<MembrainCategoryRow>,
        [
          Fk<"membrain_categories_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      membrain_entries: Table<
        MembrainEntryRow,
        Partial<MembrainEntryRow>,
        Partial<MembrainEntryRow>,
        [
          Fk<"membrain_entries_category_id_fkey", "category_id", "membrain_categories">,
          Fk<"membrain_entries_created_by_fkey", "created_by", "profiles">,
          Fk<"membrain_entries_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"membrain_entries_updated_by_fkey", "updated_by", "profiles">,
        ]
      >;
      membrain_entry_tags: Table<
        MembrainEntryTagRow,
        Partial<MembrainEntryTagRow>,
        Partial<MembrainEntryTagRow>,
        [
          Fk<"membrain_entry_tags_entry_id_fkey", "entry_id", "membrain_entries">,
          Fk<"membrain_entry_tags_tag_id_fkey", "tag_id", "membrain_tags">,
        ]
      >;
      membrain_entry_versions: Table<
        MembrainEntryVersionRow,
        Partial<MembrainEntryVersionRow>,
        Partial<MembrainEntryVersionRow>,
        [
          Fk<"membrain_entry_versions_changed_by_fkey", "changed_by", "profiles">,
          Fk<"membrain_entry_versions_entry_id_fkey", "entry_id", "membrain_entries">,
          Fk<"membrain_entry_versions_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      membrain_tags: Table<
        MembrainTagRow,
        Partial<MembrainTagRow>,
        Partial<MembrainTagRow>,
        [
          Fk<"membrain_tags_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      organisation_limits: Table<
        OrganisationLimitsRow,
        Partial<OrganisationLimitsRow>,
        Partial<OrganisationLimitsRow>,
        [
          Fk<"organisation_limits_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      organisation_members: Table<
        OrganisationMemberRow,
        Partial<OrganisationMemberRow>,
        Partial<OrganisationMemberRow>,
        [
          Fk<"organisation_members_assigned_by_fkey", "assigned_by", "profiles">,
          Fk<"organisation_members_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"organisation_members_profile_id_fkey", "profile_id", "profiles">,
        ]
      >;
      organisations: Table<
        OrganisationRow,
        Partial<OrganisationRow>,
        Partial<OrganisationRow>,
        [
          Fk<"organisations_created_by_fkey", "created_by", "profiles">,
        ]
      >;
      platform_settings: Table<PlatformSettingsRow>;
      profiles: Table<
        ProfileRow,
        Partial<ProfileRow>,
        Partial<ProfileRow>,
        [
          Fk<"profiles_id_fkey", "id", "users">,
        ]
      >;
      scheduled_posts: Table<
        ScheduledPostRow,
        Partial<ScheduledPostRow>,
        Partial<ScheduledPostRow>,
        [
          Fk<"scheduled_posts_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"scheduled_posts_social_account_id_fkey", "social_account_id", "social_accounts">,
        ]
      >;
      social_accounts: Table<
        SocialAccountRow,
        Partial<SocialAccountRow>,
        Partial<SocialAccountRow>,
        [
          Fk<"social_accounts_connected_by_fkey", "connected_by", "profiles">,
          Fk<"social_accounts_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
    };
    Views: {
      organisation_usage_snapshot: View<UsageSnapshotRow>;
    };
    Functions: {
      membrain_context: {
        Args: {
          p_organisation_id: string;
          p_query?: string | null;
          p_limit?: number | null;
        };
        Returns: MembrainContextRow[];
      };
      membrain_mark_retrieved: {
        Args: {
          p_entry_ids: string[];
        };
        Returns: unknown;
      };
      membrain_search: {
        Args: {
          p_organisation_id: string;
          p_query?: string | null;
          p_category_ids?: string[] | null;
          p_tag_ids?: string[] | null;
          p_statuses?: MembrainStatusDb[] | null;
          p_limit?: number | null;
          p_offset?: number | null;
        };
        Returns: MembrainSearchRow[];
      };
      perform_content_draft_review: {
        Args: {
          p_draft_id: string;
          p_action: ContentDraftReviewActionDb;
          p_new_status: ContentDraftStatusDb | null;
          p_assigned_reviewer_id: string | null;
          p_comment: string | null;
        };
        Returns: unknown;
      };
    };
    Enums: {
      campaign_status: CampaignStatusDb;
      connection_status: ConnectionStatusDb;
      content_draft_awo_status: ContentDraftAwoStatusDb;
      content_draft_review_action: ContentDraftReviewActionDb;
      content_draft_status: ContentDraftStatusDb;
      content_draft_type: ContentDraftTypeDb;
      membrain_source: MembrainSourceDb;
      membrain_status: MembrainStatusDb;
      organisation_role: OrganisationRoleDb;
      organisation_status: OrganisationStatusDb;
      platform_role: PlatformRoleDb;
      post_status: PostStatusDb;
      social_platform: SocialPlatformDb;
    };
    CompositeTypes: Record<string, never>;
  };
};
