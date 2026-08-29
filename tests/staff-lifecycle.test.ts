import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260822070000_staff_lifecycle.sql", "utf8");
const server = readFileSync("src/server/staff-admin.ts", "utf8");
const actions = readFileSync("src/server/actions/staff.ts", "utf8");
const ui = readFileSync("src/components/team/staff-manager.tsx", "utf8");

describe("complete staff lifecycle", () => {
  it("keeps pending edits and reactivation actor-authorised and transactional", () => {
    expect(sql).toMatch(/admin_update_pending_staff_invitation/);
    expect(sql).toMatch(/admin_reactivate_staff/);
    expect(sql).toMatch(/role in \('owner','admin'\)/);
    expect(sql).toMatch(/perform public\.admin_prepare_staff_invitation/);
  });

  it("rejects self-management and direct authenticated RPC invocation", () => {
    expect(sql).toMatch(/p_actor_id=p_profile_id/);
    expect(sql.match(/revoke all on function/g)?.length).toBe(4);
    expect(sql.match(/from public,anon,authenticated/g)?.length).toBe(4);
    expect(actions).toMatch(/requireAdmin\(c\.actor\)/);
  });

  it("blocks deletion when profile or auth attribution exists", () => {
    expect(sql).toMatch(/fk\.confrelid in \('public\.profiles'::regclass,'auth\.users'::regclass\)/);
    expect(sql).toMatch(/reviewer_ids/);
    expect(server).toMatch(/admin_staff_deletion_status/);
    expect(server).toMatch(/Historical records protect this staff identity/);
  });

  it("requires explicit destructive confirmation and offers deactivation for protected history", () => {
    expect(ui).toContain("Delete this staff member permanently?");
    expect(ui).toContain("cannot be undone");
    expect(actions).toContain('required(form,"confirmPermanentDelete") !== "yes"');
    expect(ui).toContain("Deactivate staff access");
  });

  it("reactivates the existing profile and never creates a duplicate identity", () => {
    expect(server).toMatch(/admin_reactivate_staff/);
    expect(server).toMatch(/await resendInvitation\(invitationId\)/);
    expect(server).not.toMatch(/reactivateStaff[\s\S]{0,700}createUser/);
  });
});
