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

export type ClaimAutomationEventRow = {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  organisation_id: string | null;
  payload: Json;
  occurred_at: string;
  lease_token: string;
};

export type CampaignStatusDb = "planning" | "active" | "completed" | "archived";
export type ConnectionStatusDb = "connected" | "expired" | "revoked";
export type ContentDraftAwoStatusDb = "not_requested" | "ready_for_awo";
export type ContentDraftReviewActionDb = "submitted" | "assigned" | "reassigned" | "approved" | "changes_requested" | "rejected" | "reopened";
export type ContentDraftStatusDb = "draft" | "needs_review" | "approved" | "rejected" | "in_review" | "changes_requested" | "scheduled" | "published" | "archived" | "publishing" | "failed" | "awaiting_client";
export type ContentDraftTypeDb = "social_post" | "email" | "blog_article" | "ad_copy" | "video_script" | "other" | "caption" | "campaign_copy" | "image_prompt";
export type EngagementDataBasisDb = "brand_only" | "performance_informed";
export type MembrainSourceDb = "manual" | "client_brief" | "discovery_call" | "performance_insight" | "competitor_research" | "published_asset";
export type MembrainStatusDb = "draft" | "active" | "archived";
export type OrganisationRoleDb = "lead" | "contributor" | "reviewer";
export type OrganisationStatusDb = "prospect" | "active" | "paused" | "offboarded";
export type PlatformRoleDb = "owner" | "admin" | "member";
export type PostStatusDb = "idea" | "researching" | "drafting" | "in_review" | "approved" | "scheduled" | "published" | "failed" | "archived";
export type PublishingAttemptStatusDb = "queued" | "started" | "awaiting_confirmation" | "completed" | "failed";
export type PublishingExecutionModeDb = "simulation" | "live";
export type PublishingJobStatusDb = "queued" | "processing" | "awaiting_confirmation" | "published" | "failed" | "cancelled";
export type PublishingPlatformDb = "linkedin" | "facebook" | "instagram" | "x" | "tiktok";
export type PublishingSimulationModeDb = "always_succeed" | "fail_next_attempt" | "always_fail";
export type PublishingTriggerTypeDb = "immediate" | "scheduled" | "retry";
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

export type AuditEventRow = {
  id: string;
  organisation_id: string;
  draft_id: string | null;
  actor_id: string | null;
  event_type: string;
  description: string;
  metadata: Json;
  created_at: string;
};

export type BlotatoAccountRow = {
  id: string;
  blotato_account_id: string;
  platform: string;
  fullname: string | null;
  username: string | null;
  first_connected_at: string;
  last_verified_at: string;
  created_at: string;
  updated_at: string;
};

export type BrandKitAssetRow = {
  brand_kit_id: string;
  asset_id: string;
  role: string | null;
  created_at: string;
};

export type BrandKitRow = {
  id: string;
  organisation_id: string;
  name: string;
  colors: Json | null;
  typography: Json | null;
  tone_notes: string | null;
  usage_guidance: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignAssetRow = {
  campaign_id: string;
  asset_id: string;
  attached_by: string | null;
  created_at: string;
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
  client: string | null;
  brand: string | null;
  campaign_type: string | null;
  owner_id: string | null;
  team_members: string[] | null;
  color_label: string | null;
  tags: string[] | null;
  priority: string | null;
  notes: string | null;
  assets: Json | null;
};

export type ContentDraftAssetRow = {
  draft_id: string;
  asset_id: string;
  attached_by: string | null;
  created_at: string;
};

export type ContentDraftCommentRow = {
  id: string;
  draft_id: string;
  organisation_id: string;
  author_id: string | null;
  parent_id: string | null;
  body: string;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
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
  content_type: ContentDraftTypeDb;
  status: ContentDraftStatusDb;
  change_summary: string | null;
  changed_by: string | null;
  created_at: string;
  campaign_id: string | null;
  priority: string;
  review_deadline: string | null;
  hashtags: string[];
};

export type ContentDraftRow = {
  id: string;
  organisation_id: string;
  category_id: string | null;
  title: string;
  content_type: ContentDraftTypeDb;
  summary: string | null;
  body: string;
  status: ContentDraftStatusDb;
  awo_status: ContentDraftAwoStatusDb;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  campaign_id: string | null;
  assigned_reviewer_id: string | null;
  last_review_action: ContentDraftReviewActionDb | null;
  last_review_at: string | null;
  scheduled_at: string | null;
  scheduled_platform: string | null;
  scheduled_timezone: string | null;
  due_at: string | null;
  reviewer_ids: string[] | null;
  priority: string;
  review_deadline: string | null;
  hashtags: string[];
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

export type EngagementRecommendationRow = {
  id: string;
  organisation_id: string;
  draft_id: string;
  draft_version: number;
  platform: SocialPlatformDb;
  objective: string | null;
  data_basis: EngagementDataBasisDb;
  recommended_caption: string;
  alternative_captions: string[];
  hook: string;
  cta: string;
  hashtag_groups: Json;
  rationale: string;
  predicted_strengths: string[];
  limitations: string[];
  confidence: number;
  evidence: Json;
  created_by: string | null;
  created_at: string;
};

export type ConversationSummaryRow = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  source: string;
  confidence: number;
  conversation_date: string;
  participants: string[];
  key_points: string[];
  created_at: string;
  updated_at: string;
  search_vector: unknown | null;
};

export type DailyBriefRow = {
  id: string;
  brief_date: string;
  content: Json;
  created_at: string;
};

export type DecisionReviewRow = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  source: string;
  confidence: number;
  question: string;
  options: string[];
  recommendation: string | null;
  decision: string | null;
  review_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type DecisionRow = {
  id: string;
  title: string;
  context: string | null;
  decision: string;
  status: string;
  created_at: string;
};

export type ExecutiveUserRow = {
  id: string;
  telegram_user_id: number;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
};

export type GoogleAccountRow = {
  account_key: string;
  display_name: string;
  email_address: string | null;
  status: string;
  connected_at: string | null;
  last_successful_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GoogleOauthTokenRow = {
  account_key: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expiry_date: number | null;
  scope: string;
  token_type: string;
  created_at: string;
  updated_at: string;
};

export type KnowledgeRow = {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  source: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  search_vector: unknown | null;
};

export type MediaAssetVersionRow = {
  id: string;
  asset_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  replaced_by: string | null;
  created_at: string;
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
  title: string | null;
  thumbnail_path: string | null;
  category: string | null;
  description: string | null;
  alt_text: string | null;
  tags: string[] | null;
  brand: string | null;
  duration: number | null;
  copyright_owner: string | null;
  usage_rights: string | null;
  expires_at: string | null;
  is_ai_generated: boolean;
  is_archived: boolean;
  updated_at: string;
};

export type MediaCollectionAssetRow = {
  collection_id: string;
  asset_id: string;
  position: number;
  created_at: string;
};

export type MediaCollectionRow = {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MeetingRow = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  source: string;
  confidence: number;
  occurred_at: string;
  attendees: string[];
  action_items: string[];
  created_at: string;
  updated_at: string;
  search_vector: unknown | null;
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

export type NotificationRow = {
  id: string;
  organisation_id: string;
  profile_id: string;
  type: string;
  message: string;
  is_read: boolean;
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

export type PlaybookRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  source: string;
  confidence: number;
  version: number;
  approval_status: string;
  created_at: string;
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

export type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: number;
  created_at: string;
  updated_at: string;
};

export type PublishingAttemptRow = {
  id: string;
  job_id: string;
  organisation_id: string;
  draft_id: string;
  platform: PublishingPlatformDb;
  attempt_number: number;
  status: PublishingAttemptStatusDb;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  duration_ms: number | null;
  external_post_id: string | null;
  external_url: string | null;
  error_code: string | null;
  error_message: string | null;
  retry_of_attempt_id: string | null;
  provider_metadata: Json;
  created_at: string;
};

export type PublishingJobRow = {
  id: string;
  organisation_id: string;
  draft_id: string;
  platform: PublishingPlatformDb;
  trigger_type: PublishingTriggerTypeDb;
  scheduled_for: string;
  status: PublishingJobStatusDb;
  idempotency_key: string;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  next_attempt_at: string | null;
  retry_count: number;
  max_retries: number;
  completed_at: string | null;
  cancelled_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  dev_simulation_mode: PublishingSimulationModeDb | null;
  resolved_account_id: string | null;
  is_ai_generated: boolean | null;
  is_your_brand: boolean | null;
  is_branded_content: boolean | null;
  execution_mode: PublishingExecutionModeDb;
  next_status_check_at: string | null;
  last_status_check_at: string | null;
  status_check_count: number;
  awaiting_confirmation_since: string | null;
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

export type TaskRow = {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  completed_at: string | null;
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

export type SearchConversationSummaryRow = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  source: string;
  confidence: number;
  conversation_date: string;
  participants: string[];
  key_points: string[];
  created_at: string;
  updated_at: string;
  rank: number;
};

export type SearchKnowledgeRow = {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  source: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  rank: number;
};

export type SearchMeetingRow = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  source: string;
  confidence: number;
  occurred_at: string;
  attendees: string[];
  action_items: string[];
  created_at: string;
  updated_at: string;
  rank: number;
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
      audit_events: Table<
        AuditEventRow,
        Partial<AuditEventRow>,
        Partial<AuditEventRow>,
        [
          Fk<"audit_events_actor_id_fkey", "actor_id", "profiles">,
          Fk<"audit_events_draft_id_fkey", "draft_id", "content_drafts">,
          Fk<"audit_events_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      blotato_accounts: Table<BlotatoAccountRow>;
      brand_kit_assets: Table<
        BrandKitAssetRow,
        Partial<BrandKitAssetRow>,
        Partial<BrandKitAssetRow>,
        [
          Fk<"brand_kit_assets_asset_id_fkey", "asset_id", "media_assets">,
          Fk<"brand_kit_assets_brand_kit_id_fkey", "brand_kit_id", "brand_kits">,
        ]
      >;
      brand_kits: Table<
        BrandKitRow,
        Partial<BrandKitRow>,
        Partial<BrandKitRow>,
        [
          Fk<"brand_kits_created_by_fkey", "created_by", "profiles">,
          Fk<"brand_kits_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      campaign_assets: Table<
        CampaignAssetRow,
        Partial<CampaignAssetRow>,
        Partial<CampaignAssetRow>,
        [
          Fk<"campaign_assets_asset_id_fkey", "asset_id", "media_assets">,
          Fk<"campaign_assets_attached_by_fkey", "attached_by", "profiles">,
          Fk<"campaign_assets_campaign_id_fkey", "campaign_id", "campaigns">,
        ]
      >;
      campaigns: Table<
        CampaignRow,
        Partial<CampaignRow>,
        Partial<CampaignRow>,
        [
          Fk<"campaigns_created_by_fkey", "created_by", "profiles">,
          Fk<"campaigns_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"campaigns_owner_id_fkey", "owner_id", "profiles">,
          Fk<"campaigns_updated_by_fkey", "updated_by", "profiles">,
        ]
      >;
      content_draft_assets: Table<
        ContentDraftAssetRow,
        Partial<ContentDraftAssetRow>,
        Partial<ContentDraftAssetRow>,
        [
          Fk<"content_draft_assets_asset_id_fkey", "asset_id", "media_assets">,
          Fk<"content_draft_assets_attached_by_fkey", "attached_by", "profiles">,
          Fk<"content_draft_assets_draft_id_fkey", "draft_id", "content_drafts">,
        ]
      >;
      content_draft_comments: Table<
        ContentDraftCommentRow,
        Partial<ContentDraftCommentRow>,
        Partial<ContentDraftCommentRow>,
        [
          Fk<"content_draft_comments_author_id_fkey", "author_id", "profiles">,
          Fk<"content_draft_comments_draft_id_fkey", "draft_id", "content_drafts">,
          Fk<"content_draft_comments_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"content_draft_comments_parent_id_fkey", "parent_id", "content_draft_comments">,
          Fk<"content_draft_comments_resolved_by_fkey", "resolved_by", "profiles">,
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
      engagement_recommendations: Table<
        EngagementRecommendationRow,
        Partial<EngagementRecommendationRow>,
        Partial<EngagementRecommendationRow>,
        [
          Fk<"engagement_recommendations_created_by_fkey", "created_by", "profiles">,
          Fk<"engagement_recommendations_draft_org_fkey", "draft_id", "content_drafts">,
          Fk<"engagement_recommendations_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      conversation_summaries: Table<ConversationSummaryRow>;
      daily_briefs: Table<DailyBriefRow>;
      decision_reviews: Table<DecisionReviewRow>;
      decisions: Table<DecisionRow>;
      executive_users: Table<ExecutiveUserRow>;
      google_accounts: Table<GoogleAccountRow>;
      google_oauth_tokens: Table<GoogleOauthTokenRow>;
      knowledge: Table<KnowledgeRow>;
      media_asset_versions: Table<
        MediaAssetVersionRow,
        Partial<MediaAssetVersionRow>,
        Partial<MediaAssetVersionRow>,
        [
          Fk<"media_asset_versions_asset_id_fkey", "asset_id", "media_assets">,
          Fk<"media_asset_versions_replaced_by_fkey", "replaced_by", "profiles">,
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
      media_collection_assets: Table<
        MediaCollectionAssetRow,
        Partial<MediaCollectionAssetRow>,
        Partial<MediaCollectionAssetRow>,
        [
          Fk<"media_collection_assets_asset_id_fkey", "asset_id", "media_assets">,
          Fk<"media_collection_assets_collection_id_fkey", "collection_id", "media_collections">,
        ]
      >;
      media_collections: Table<
        MediaCollectionRow,
        Partial<MediaCollectionRow>,
        Partial<MediaCollectionRow>,
        [
          Fk<"media_collections_created_by_fkey", "created_by", "profiles">,
          Fk<"media_collections_organisation_id_fkey", "organisation_id", "organisations">,
        ]
      >;
      meetings: Table<MeetingRow>;
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
      notifications: Table<
        NotificationRow,
        Partial<NotificationRow>,
        Partial<NotificationRow>,
        [
          Fk<"notifications_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"notifications_profile_id_fkey", "profile_id", "profiles">,
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
      playbooks: Table<PlaybookRow>;
      profiles: Table<
        ProfileRow,
        Partial<ProfileRow>,
        Partial<ProfileRow>,
        [
          Fk<"profiles_id_fkey", "id", "users">,
        ]
      >;
      projects: Table<ProjectRow>;
      publishing_attempts: Table<
        PublishingAttemptRow,
        Partial<PublishingAttemptRow>,
        Partial<PublishingAttemptRow>,
        [
          Fk<"publishing_attempts_draft_id_fkey", "draft_id", "content_drafts">,
          Fk<"publishing_attempts_job_id_fkey", "job_id", "publishing_jobs">,
          Fk<"publishing_attempts_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"publishing_attempts_retry_of_attempt_id_fkey", "retry_of_attempt_id", "publishing_attempts">,
        ]
      >;
      publishing_jobs: Table<
        PublishingJobRow,
        Partial<PublishingJobRow>,
        Partial<PublishingJobRow>,
        [
          Fk<"publishing_jobs_draft_id_fkey", "draft_id", "content_drafts">,
          Fk<"publishing_jobs_organisation_id_fkey", "organisation_id", "organisations">,
          Fk<"publishing_jobs_requested_by_fkey", "requested_by", "profiles">,
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
      tasks: Table<
        TaskRow,
        Partial<TaskRow>,
        Partial<TaskRow>,
        [
          Fk<"tasks_project_id_fkey", "project_id", "projects">,
        ]
      >;
    };
    Views: {
      organisation_usage_snapshot: View<UsageSnapshotRow>;
    };
    Functions: {
      ack_automation_event: {
        Args: { p_event_id: string; p_consumer: string; p_lease_token: string };
        Returns: boolean;
      };
      automation_status_snapshot: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      claim_automation_events: {
        Args: { p_consumer: string; p_limit?: number | null; p_lease_seconds?: number | null };
        Returns: ClaimAutomationEventRow[];
      };
      claim_next_publishing_job: {
        Args: {
          p_worker_id: string;
        };
        Returns: unknown;
      };
      claim_publishing_job_for_confirmation: {
        Args: {
          p_worker_id: string;
          p_lease_seconds?: number;
        };
        Returns: unknown;
      };
      immutable_array_to_string: {
        Args: {
          arr: string[];
          sep: string;
        };
        Returns: unknown;
      };
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
          p_new_status: ContentDraftStatusDb;
          p_assigned_reviewer_id: string;
          p_comment: string;
        };
        Returns: unknown;
      };
      recover_stale_publishing_jobs: {
        Args: {
          p_stale_after_seconds?: number | null;
        };
        Returns: unknown;
      };
      search_conversation_summaries: {
        Args: {
          search_query: string;
          result_limit?: number | null;
        };
        Returns: SearchConversationSummaryRow[];
      };
      search_knowledge: {
        Args: {
          search_query: string;
          result_limit?: number | null;
        };
        Returns: SearchKnowledgeRow[];
      };
      search_meetings: {
        Args: {
          search_query: string;
          result_limit?: number | null;
        };
        Returns: SearchMeetingRow[];
      };
    };
    Enums: {
      campaign_status: CampaignStatusDb;
      connection_status: ConnectionStatusDb;
      content_draft_awo_status: ContentDraftAwoStatusDb;
      content_draft_review_action: ContentDraftReviewActionDb;
      content_draft_status: ContentDraftStatusDb;
      content_draft_type: ContentDraftTypeDb;
      engagement_data_basis: EngagementDataBasisDb;
      membrain_source: MembrainSourceDb;
      membrain_status: MembrainStatusDb;
      organisation_role: OrganisationRoleDb;
      organisation_status: OrganisationStatusDb;
      platform_role: PlatformRoleDb;
      post_status: PostStatusDb;
      publishing_attempt_status: PublishingAttemptStatusDb;
      publishing_job_status: PublishingJobStatusDb;
      publishing_platform: PublishingPlatformDb;
      publishing_simulation_mode: PublishingSimulationModeDb;
      publishing_trigger_type: PublishingTriggerTypeDb;
      social_platform: SocialPlatformDb;
    };
    CompositeTypes: Record<string, never>;
  };
};

