import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/20260816090000_awo_market_intelligence_v1.sql", "utf8");
const objectiveSql = readFileSync("supabase/migrations/20260816120000_expand_market_business_objectives.sql", "utf8");
describe("Market Intelligence migration", () => {
  it("uses exactly three client-owned tables and defers templates", () => { expect((sql.match(/create table public\.market_intelligence_/g) ?? [])).toHaveLength(3); expect(sql).not.toContain("create table public.market_intelligence_templates"); });
  it.each(["profiles", "references", "patterns"])("enables RLS and organisation policies for %s", (name) => { expect(sql).toContain(`alter table public.market_intelligence_${name} enable row level security`); expect(sql).toContain(`app.is_org_member(organisation_id)`); expect(sql).toContain(`app.can_write_org(organisation_id)`); });
  it("keeps client rows organisation scoped", () => { expect((sql.match(/organisation_id uuid/g) ?? []).length).toBeGreaterThanOrEqual(3); expect(sql).toContain("references public.organisations (id) on delete cascade"); });
  it("prevents caption archives and stores strategy labels without duplicating metrics", () => { expect(sql).toContain("market_pattern_anti_archive"); expect(sql).toContain("strategy_metadata jsonb"); expect(sql).not.toContain("create table public.market_intelligence_metrics"); });
  it("expands objectives without changing ownership, tables, or RLS", () => { expect(objectiveSql).toContain("'awareness'"); expect(objectiveSql).toContain("'attendance'"); expect(objectiveSql).toContain("'lead_generation'"); expect(objectiveSql).not.toContain("create table"); expect(objectiveSql).not.toContain("policy"); });
});
