import { describe, expect, it } from "vitest";
import { buildContextPack, estimateTokens } from "@/core/application/use-cases/membrain/context-pack";
import type { MembrainContextItem } from "@/core/domain/entities/membrain";

function item(overrides: Partial<MembrainContextItem> = {}): MembrainContextItem {
  return {
    id: crypto.randomUUID(),
    title: "Tone of voice",
    summary: "How the client sounds",
    body: "Warm, direct, never corporate.",
    categoryKey: "brand_voice",
    categoryLabel: "Brand voice",
    importance: 5,
    version: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("context pack assembly", () => {
  it("tells the model the client knowledge outranks its own assumptions", () => {
    const pack = buildContextPack({
      organisationId: "org-1",
      organisationName: "Villiz Pixels",
      query: "spring campaign",
      items: [item()],
      maxCharacters: 24000,
    });

    expect(pack.prompt).toContain("Villiz Pixels");
    expect(pack.prompt).toContain("the knowledge below wins");
    expect(pack.prompt).toContain("Retrieved for: spring campaign");
  });

  it("says so plainly when a client has no knowledge yet", () => {
    const pack = buildContextPack({
      organisationId: "org-1",
      organisationName: "Genesis Test Client",
      query: null,
      items: [],
      maxCharacters: 24000,
    });

    expect(pack.prompt).toContain("No knowledge has been recorded");
    expect(pack.items).toHaveLength(0);
    expect(pack.truncated).toBe(false);
  });

  it("reports truncation rather than silently dropping knowledge", () => {
    const long = item({ body: "x".repeat(4000), title: "Very long entry" });
    const pack = buildContextPack({
      organisationId: "org-1",
      organisationName: "Villiz Pixels",
      query: null,
      items: [item({ title: "Short one" }), long],
      maxCharacters: 500,
    });

    expect(pack.truncated).toBe(true);
    expect(pack.items.map((i) => i.title)).toContain("Short one");
    expect(pack.items.map((i) => i.title)).not.toContain("Very long entry");
  });

  it("never exceeds the character budget it was given", () => {
    const items = Array.from({ length: 50 }, (_, index) =>
      item({ title: `Entry ${index}`, body: "y".repeat(300) }),
    );

    const budget = 2000;
    const pack = buildContextPack({
      organisationId: "org-1",
      organisationName: "Villiz Pixels",
      query: null,
      items,
      maxCharacters: budget,
    });

    expect(pack.prompt.length).toBeLessThanOrEqual(budget);
    expect(pack.truncated).toBe(true);
  });

  it("keeps earlier — higher ranked — knowledge when the budget is tight", () => {
    const pack = buildContextPack({
      organisationId: "org-1",
      organisationName: "Villiz Pixels",
      query: null,
      items: [
        item({ title: "Critical rule", body: "z".repeat(200) }),
        item({ title: "Nice to know", body: "z".repeat(200) }),
      ],
      maxCharacters: 500,
    });

    expect(pack.items[0]?.title).toBe("Critical rule");
  });

  it("never claims a client has no knowledge when knowledge was dropped", () => {
    const pack = buildContextPack({
      organisationId: "org-1",
      organisationName: "Villiz Pixels",
      query: null,
      items: [item({ title: "Never claim guaranteed results", body: "z".repeat(5000) })],
      maxCharacters: 400,
    });

    expect(pack.prompt).not.toContain("No knowledge has been recorded");
    expect(pack.prompt).toContain("truncated");
    expect(pack.truncated).toBe(true);
    expect(pack.items).toHaveLength(1);
    expect(pack.prompt.length).toBeLessThanOrEqual(400);
  });

  it("carries provenance into the prompt so a claim can be traced", () => {
    const pack = buildContextPack({
      organisationId: "org-1",
      organisationName: "Villiz Pixels",
      query: null,
      items: [item({ title: "Legal restriction", version: 4, importance: 5 })],
      maxCharacters: 24000,
    });

    expect(pack.prompt).toContain("## Legal restriction");
    expect(pack.prompt).toContain("v4");
    expect(pack.prompt).toContain("Brand voice");
  });

  it("estimates tokens consistently with the assembled prompt", () => {
    const pack = buildContextPack({
      organisationId: "org-1",
      organisationName: "Villiz Pixels",
      query: null,
      items: [item()],
      maxCharacters: 24000,
    });

    expect(pack.estimatedTokens).toBe(estimateTokens(pack.prompt));
    expect(pack.estimatedTokens).toBeGreaterThan(0);
  });
});
