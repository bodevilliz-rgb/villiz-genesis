import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260815070000_media_safe_delete.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("Media Safe Delete v1 migration contract", () => {
  it("tracks never-used status without blessing unknown pre-migration history", () => {
    expect(migration).toContain("usage_tracking_started_at timestamptz");
    expect(migration).toContain("first_used_at timestamptz");
    expect(migration).toContain("alter column usage_tracking_started_at set default now()");
    expect(migration).not.toMatch(/update public\.media_assets[\s\S]{0,120}usage_tracking_started_at\s*=\s*now/);
  });

  it.each([
    "content_draft_assets_mark_media_used",
    "campaign_assets_mark_media_used",
    "media_collection_assets_mark_media_used",
    "brand_kit_assets_mark_media_used",
    "engagement_recommendations_mark_media_used",
  ])("records irreversible historical use through %s", (trigger) => {
    expect(migration).toContain(trigger);
  });

  it.each([
    "used_by_content",
    "used_by_campaign",
    "used_by_collection",
    "used_by_brand_kit",
    "publishing_dependency",
    "historical_intelligence_reference",
    "historical_use",
    "insufficient_permission",
    "invalid_storage_ownership",
    "incomplete_path_inventory",
    "unknown_dependency",
  ])("contains structured block reason %s", (reason) => {
    expect(migration).toContain(reason);
  });

  it("reads the JSON array value when classifying historical intelligence evidence", () => {
    expect(migration).toContain("evidence.value ->> 'sourcetype' = 'media_asset'");
    expect(migration).toContain("evidence.value ->> 'sourceid' = p_asset_id::text");
  });

  it("treats queued, processing, awaiting-confirmation and retryable failed jobs as dependencies", () => {
    expect(migration).toContain("j.status in ('queued', 'processing', 'awaiting_confirmation', 'failed')");
  });

  it("captures active, version and real thumbnail paths in the transaction", () => {
    expect(migration).toContain("select v_asset.storage_path as path");
    expect(migration).toContain("select v_asset.thumbnail_path where v_asset.thumbnail_path is not null");
    expect(migration).toContain("select storage_path from public.media_asset_versions where asset_id = p_asset_id");
  });

  it("locks, rechecks, records durable work and audit, then deletes", () => {
    const lock = migration.indexOf("for update;");
    const recheck = migration.indexOf("get_media_deletion_status", lock);
    const ledger = migration.indexOf("insert into public.media_deletion_requests", recheck);
    const audit = migration.indexOf("insert into public.audit_events", ledger);
    const deletion = migration.indexOf("delete from public.media_assets", audit);
    expect(lock).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(lock);
    expect(ledger).toBeGreaterThan(recheck);
    expect(audit).toBeGreaterThan(ledger);
    expect(deletion).toBeGreaterThan(audit);
  });

  it("makes duplicate requests idempotent and cleanup retryable", () => {
    expect(migration).toContain("unique (organisation_id, former_asset_id)");
    expect(migration).toContain("cleanup_attempt_count = cleanup_attempt_count + 1");
    expect(migration).toContain("exception when unique_violation");
    expect(migration).toContain("a concurrent request may have completed while this transaction waited");
    expect(migration).toContain("if v_request.cleanup_state = 'complete' then");
  });

  it("aligns permanent DB deletion with lead/admin management authority", () => {
    expect(migration).toContain("create policy media_assets_delete");
    expect(migration).toContain("for delete to authenticated using (app.can_manage_org(organisation_id))");
    expect(migration).toContain("if not app.can_manage_org(p_organisation_id)");
  });

  it("rejects cross-organisation attachment references while recording first use", () => {
    expect(migration).toContain("where id = v_asset_id and organisation_id = v_organisation_id");
    expect(migration).toContain("belongs to another organisation");
  });

  it("allows authenticated callers only and denies direct ledger mutation", () => {
    expect(migration).toContain("grant execute on function public.request_media_safe_delete");
    expect(migration).toContain("revoke all on public.media_deletion_requests from anon, authenticated");
    expect(migration).toContain("grant select on public.media_deletion_requests to authenticated");
  });

  it("allows only the service role to attest Storage cleanup completion", () => {
    expect(migration).toContain("if (select auth.role()) <> 'service_role'");
    expect(migration).toContain(
      "revoke all on function public.record_media_cleanup_result(uuid, uuid, boolean, text) from anon, authenticated",
    );
    expect(migration).toContain("grant execute on function public.record_media_cleanup_result");
    expect(migration).toContain("to service_role");
    expect(migration).not.toMatch(/grant execute on function public\.record_media_cleanup_result[\s\S]{0,120}to authenticated/);
    expect(migration).toContain("v_request.requested_by, 'media_storage_cleanup_completed'");
  });
});
