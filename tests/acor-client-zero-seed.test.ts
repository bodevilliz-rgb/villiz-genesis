import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const seed = readFileSync("supabase/seed.sql", "utf8");
const engine = [readFileSync("src/core/domain/entities/acor.ts", "utf8"), readFileSync("src/core/application/use-cases/market-intelligence/context.ts", "utf8"), readFileSync("src/core/application/use-cases/market-intelligence/visibility.ts", "utf8")].join("\n");

describe("ACOR Client Zero local grounding", () => {
  it("uses ordinary organisation-scoped records rather than client-name engine branches", () => {
    expect(seed).toContain("Villiz Pixels UK"); expect(seed).toContain("market_intelligence_profiles"); expect(seed).toContain("membrain_entries");
    expect(engine).not.toMatch(/Villiz|Mervic/i);
  });
  it("grounds all six authoritative MemBrain categories from owner-approved source material", () => {
    for (const category of ["brand_description", "brand_voice", "audience", "content_pillars", "offering", "guidelines"]) expect(seed).toContain(`'${category}'`);
    expect(seed).toContain("'client_brief'::public.membrain_source");
    expect(seed).toContain("The forensic report itself is not authoritative");
  });
  it("keeps weak services weak and does not claim a proprietary process", () => {
    expect(seed).toContain("describe a service as more established than the approved evidence supports");
    expect(seed).toContain("avoiding claims of a proven proprietary end-to-end method");
  });
  it("keeps cultural treatment optional and UK learning isolated", () => {
    expect(seed).toContain("'conversational'"); expect(seed).toContain("LIGHT_NAIJA is contextual only");
    expect(seed).not.toContain("Villiz Pixels Nigeria");
  });
  it("keeps durable MemBrain truth free from ACOR strategy and proof-status syntax", () => {
    const membrainSeed = seed.slice(seed.indexOf("INSERT INTO public.membrain_entries"), seed.indexOf("INSERT INTO public.market_intelligence_profiles"));
    for (const leakedPhrase of ["dominant consumer-facing and search proposition", "approved customer proposition", "strategic expression", "separate secondary pathways", "ADEQUATELY_PROVEN", "CONFIRMED_UNPROVEN", "TikTok Creator Search Insights", "Thirty-day sequence"])
      expect(membrainSeed).not.toContain(leakedPhrase);
    expect(membrainSeed).toContain("Creatively directed portraits you''re proud to be seen in");
    expect(membrainSeed).toContain("Where Every Frame Tells a Story");
  });
  it("retains all eight entries across the six authoritative categories", () => {
    const membrainSeed = seed.slice(seed.indexOf("INSERT INTO public.membrain_entries"), seed.indexOf("INSERT INTO public.market_intelligence_profiles"));
    expect(membrainSeed.match(/'a0000000-0000-4000-a000-00000000000[1-8]'/g)).toHaveLength(8);
    for (const category of ["brand_description", "brand_voice", "audience", "content_pillars", "offering", "guidelines"])
      expect(membrainSeed).toContain(`'${category}'`);
  });
  it("stores the reviewed service proof matrix in organisation-scoped Market Intelligence, not MemBrain", () => {
    const membrainSeed = seed.slice(seed.indexOf("INSERT INTO public.membrain_entries"), seed.indexOf("INSERT INTO public.market_intelligence_profiles"));
    const patternsSeed = seed.slice(seed.indexOf("INSERT INTO public.market_intelligence_patterns"));
    for (const proofDepth of ["ADEQUATELY_PROVEN", "UNDER_PROVEN", "CONFIRMED_UNPROVEN"])
      expect(membrainSeed).not.toContain(proofDepth);
    for (const service of ["portrait photography", "creative/editorial photography", "birthday/milestone photography", "family photography", "event photography", "personal-brand/branding photography", "videography"])
      expect(patternsSeed).toContain(service);
    expect(patternsSeed).toContain("ACOR forensic review plus owner-confirmed service catalogue and direct inspection of the Villiz Pixels UK proof pack");
    expect(patternsSeed).toContain("ADEQUATELY_PROVEN is not STRONGLY_PROVEN");
    expect(patternsSeed).toContain("Visual evidence does not establish consent, testimonials, customer experience, commercial outcomes, reach, enquiries, bookings or revenue");
  });
  it("marks operational seed campaigns and drafts as simulation fixtures rather than ACOR evidence", () => {
    expect(seed).toContain("[LOCAL FIXTURE] Summer Launch 2026");
    expect(seed).toContain("[LOCAL FIXTURE] Q3 Brand Awareness");
    expect(seed).toContain("Not a real Villiz Pixels UK campaign, result or source of ACOR evidence");
    expect(seed).not.toContain("Objective to reach 10k users");
  });
  it("records autocomplete as directional evidence without inventing volume", () => {
    expect(seed).toContain("birthday photoshoot coventry"); expect(seed).toContain("volume NOT_MEASURED"); expect(seed).not.toMatch(/search volume[:=]\s*\d/i);
  });
  it("retains honest Day-0 states and pending evidence gates", () => {
    for (const state of ["ACTUAL", "NOT_CONFIGURED", "NOT_MEASURED", "OWNER_ANALYTICS_REQUIRED", "PENDING"]) expect(seed).toContain(state);
    expect(seed).toContain("3 followers, 1 following, 5 posts");
  });
  it("separates explicit outcomes from visibility and engagement", () => {
    expect(seed).toContain("Never infer commercial outcomes from reach or engagement");
    expect(seed).toContain("Attribute explicit enquiries and bookings");
  });
});
