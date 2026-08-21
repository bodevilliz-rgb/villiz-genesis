import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260821183000_staff_onboarding.sql", "utf8");
const adminSql = readFileSync("supabase/migrations/20260821190000_staff_admin_profile_rpc.sql", "utf8");

describe("staff onboarding database boundary", () => {
  it("keeps invitation records platform-admin only", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/app\.is_platform_admin\(\)/);
    expect(sql).not.toMatch(/grant\s+.*\s+to\s+anon/i);
  });

  it("keeps the profile activation bridge service-role-only and rechecks the actor", () => {
    expect(adminSql).toMatch(/id = p_actor_id and is_active and role in \('owner', 'admin'\)/i);
    expect(adminSql).toMatch(/revoke all[\s\S]*from authenticated/i);
    expect(adminSql).toMatch(/grant execute[\s\S]*to service_role/i);
    expect(adminSql).toMatch(/retain at least one active platform administrator/i);
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
