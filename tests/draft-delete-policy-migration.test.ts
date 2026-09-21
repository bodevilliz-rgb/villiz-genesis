import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260921184500_align_unpublished_draft_delete_policy.sql"),
  "utf8",
).toLowerCase();

describe("unpublished draft deletion database policy", () => {
  it("allows authorised deletion for every state except scheduled, publishing, and published", () => {
    expect(sql).toContain("drop policy if exists content_drafts_delete_unpublished");
    expect(sql).toContain("status not in ('scheduled', 'publishing', 'published')");
    expect(sql).toContain("app.can_write_org(organisation_id)");
  });

  it("preserves direct review-history immutability while allowing an FK cascade", () => {
    expect(sql).toContain("create or replace function app.guard_content_draft_reviews_immutable()");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("tg_op = 'delete' and pg_trigger_depth() > 1");
    expect(sql).toContain("return old");
    expect(sql).toContain("raise exception 'review history cannot be modified or deleted'");
  });
});
