import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260821183000_staff_onboarding.sql", "utf8");

describe("staff onboarding database boundary", () => {
  it("keeps invitation records platform-admin only", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/app\.is_platform_admin\(\)/);
    expect(sql).not.toMatch(/grant\s+.*\s+to\s+anon/i);
  });

  it("enforces one live invitation per exact lower-case identity", () => {
    expect(sql).toMatch(/email = lower\(email\)/);
    expect(sql).toMatch(/unique index[\s\S]*where status = 'pending'/i);
  });

  it("does not duplicate client access or historical actor storage", () => {
    expect(sql).not.toMatch(/create table public\.organisation_members/i);
    expect(sql).not.toMatch(/drop table|truncate|delete from/i);
  });
});
