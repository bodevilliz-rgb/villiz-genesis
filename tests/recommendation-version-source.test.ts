import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getCurrentEngagementRecommendation } from "@/core/application/use-cases/engagement";
import type { EngagementRepository } from "@/core/application/ports/engagement-port";
import type { OrganisationRepository } from "@/core/application/ports/organisation-port";
import type { Actor } from "@/core/domain/entities/identity";

describe("current draft recommendation source", () => {
  it("reads the recommendation for the exact current draft version", async () => {
    const findLatestForDraftVersion = vi.fn(async () => null);
    const actor = { isPlatformAdmin: false } as Actor;
    const organisations = { viewerRole: vi.fn(async () => "reviewer") } as unknown as OrganisationRepository;
    const engagement = { findLatestForDraftVersion } as unknown as EngagementRepository;

    await getCurrentEngagementRecommendation(
      { actor, organisations, engagement },
      "org-1",
      "draft-1",
      7,
    );

    expect(findLatestForDraftVersion).toHaveBeenCalledWith("org-1", "draft-1", 7);
  });


  it("makes recommendation writes atomic with the current draft version and versions material context edits", () => {
    const migrationPath = path.resolve(
      import.meta.dirname,
      "../supabase/migrations/20260915120000_current_draft_recommendation.sql",
    );
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain("engagement_recommendation_current_version_guard");
    expect(migration).toContain("for update");
    expect(migration).toContain("new.draft_version <> v_current_version");
    expect(migration).toContain("content_draft_assets_bump_version");
    expect(migration).toContain("after insert or delete on public.content_draft_assets");
    expect(migration).toContain("media_asset_context_bump_draft_versions");
    expect(migration).toContain("after update on public.media_assets");
    expect(migration).toContain("new.usage_rights is distinct from old.usage_rights");
    expect(migration).toContain("new.priority is distinct from old.priority");
    expect(migration).toContain("new.review_deadline is distinct from old.review_deadline");
    expect(migration).toContain("campaign_objective_bump_draft_versions");
    expect(migration).toContain("new.platforms is distinct from old.platforms");
    expect(migration).toContain("after update of objective, platforms on public.campaigns");
    expect(migration).toContain("p_expected_version integer");
    expect(migration).toContain("v_current_version <> p_expected_version");
    expect(migration).toContain(`create function public.perform_content_draft_review(
  p_draft_id uuid,
  p_action public.content_draft_review_action,
  p_new_status public.content_draft_status,
  p_assigned_reviewer_id uuid,
  p_comment text
)`);
    expect(migration).toContain("p_comment,\n    null::integer");
    expect(migration.match(/create function public\.perform_content_draft_review\(/g)).toHaveLength(2);
    expect(migration).not.toMatch(/p_(?:draft_id|action|new_status|assigned_reviewer_id|comment|expected_version)[^,\n)]*\sdefault\s/i);
    const reviewFunction = migration.split("create function public.perform_content_draft_review(")[1] ?? "";
    expect(reviewFunction).toContain("v_updated_rows int");
    expect(reviewFunction).toContain("get diagnostics v_updated_rows = row_count");
    expect(reviewFunction).toContain("if v_updated_rows = 0 then");
    expect(reviewFunction).toContain("using errcode = '42501'");
    expect(migration.match(/set version = [^;]+status = case/gs)).not.toBeNull();
    expect(migration).toContain("when status in ('approved', 'scheduled', 'failed') then 'needs_review'");
    expect(migration).toContain("cancel_outdated_draft_publishing_jobs");
    expect(migration).toContain("and status = 'queued'");
    const bumpFunction = migration.split("create or replace function app.content_draft_bump_version()")[1]
      ?.split("create or replace function app.bump_content_draft_recommendation_version()")[0] ?? "";
    expect(bumpFunction).not.toContain("new.status is distinct from old.status");
    expect(bumpFunction).not.toContain("new.scheduled_platform is distinct from old.scheduled_platform");
  });

  it("invalidates content and review caches when a campaign objective changes", () => {
    const actions = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/server/actions/campaigns.ts"),
      "utf8",
    );

    expect(actions).toContain("revalidatePath(routes.organisations.content.index(organisationId))");
    expect(actions).toContain("revalidatePath(routes.review)");
    expect(actions).toContain("revalidatePath(routes.dashboard)");
  });
});