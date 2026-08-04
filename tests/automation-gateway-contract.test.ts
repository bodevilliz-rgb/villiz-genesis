import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260804150000_automation_gateway.sql"),
  "utf8",
);

describe("Awo/n8n automation gateway contract", () => {
  it("uses leased, concurrency-safe event claims", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("claim_expires_at");
    expect(migration).toContain("p_lease_token uuid");
  });

  it("keeps the event table behind the service role", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.automation_events from anon, authenticated");
    expect(migration).toContain("to service_role");
  });

  it("emits semantic review and publishing events", () => {
    expect(migration).toContain("'review.' || new.action::text");
    expect(migration).toContain("'publishing.' || new.status::text");
  });

  it("does not expose content bodies, comments, emails, media URLs, or secrets", () => {
    for (const forbidden of ["body", "comment", "email", "media_url", "service_role_key", "api_key"]) {
      expect(migration.toLowerCase()).not.toContain(`'${forbidden}'`);
    }
  });

  it("exposes only status, claim, and acknowledgement API routes", () => {
    const apiRoot = path.join(root, "src/app/api/automation/v1");
    const routes = fs
      .readdirSync(apiRoot, { recursive: true })
      .filter((entry) => entry.toString().endsWith("route.ts"))
      .map(String)
      .sort();
    expect(routes).toEqual([
      "events/[eventId]/ack/route.ts",
      "events/claim/route.ts",
      "status/route.ts",
    ]);
  });
});
