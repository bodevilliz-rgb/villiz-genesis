import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260828090000_intent_opportunity_engine.sql", "utf8");

describe("Intent-to-Opportunity migration", () => {
  it("keeps every signal organisation scoped and cascade-safe", () => {
    expect(sql).toContain("organisation_id uuid not null references public.organisations (id) on delete cascade");
    expect(sql).toContain("intent_signals_org_service_locality_idx");
  });

  it("enforces RLS for members and organisation writers", () => {
    expect(sql).toContain("alter table public.intent_signals enable row level security");
    expect(sql).toContain("app.is_org_member(organisation_id)");
    expect(sql).toContain("app.can_write_org(organisation_id)");
    expect(sql).toContain("created_by = (select auth.uid())");
  });

  it("does not create fields for raw conversations or customer identifiers", () => {
    expect(sql).not.toMatch(/phone_number|email_address|customer_name|transcript|message_body|recording_url/);
    expect(sql).toContain("Never store raw calls, messages, contact details or sensitive traits");
  });
});
