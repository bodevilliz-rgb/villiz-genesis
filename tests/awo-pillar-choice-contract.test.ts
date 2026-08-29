import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildApprovedPillarChoices,
  PILLAR_CHOICE_CONTRACT_VERSION,
  resolveApprovedPillarChoice,
} from "@/server/actions/awo-grounding";

const modern = [
  { id: "org-a-entry-1", title: "Creative portrait concepts", body: "Approved creative portrait guidance.", version: 3 },
  { id: "org-a-entry-2", title: "Portrait preparation", body: "Approved preparation guidance.", version: 2 },
];

describe("request-scoped approved MemBrain pillar choices", () => {
  it("builds deterministic identifiers for modern active entries", () => {
    expect(buildApprovedPillarChoices(modern)).toEqual([
      { choiceId: "P1", sourceEntryId: "org-a-entry-1", sourceEntryVersion: 3, label: "Creative portrait concepts", context: "Approved creative portrait guidance." },
      { choiceId: "P2", sourceEntryId: "org-a-entry-2", sourceEntryVersion: 2, label: "Portrait preparation", context: "Approved preparation guidance." },
    ]);
    expect(PILLAR_CHOICE_CONTRACT_VERSION).toBe("awo-pillar-choice-v1");
  });

  it("normalises a complete legacy container into numbered semantic sections", () => {
    const body = [
      "CLIENT — CONTENT PILLARS",
      "",
      "PURPOSE",
      "Long approved introduction that is not itself a pillar.",
      "",
      "1. BEAUTY & STYLE EDUCATION",
      "Approved education guidance.",
      "",
      "2. TRANSFORMATION STORIES",
      "Approved transformation guidance.",
      "",
      "3. CLIENT PREPARATION",
      "Approved preparation guidance.",
    ].join("\n");
    const choices = buildApprovedPillarChoices([{ id: "legacy-main", title: "Content Pillars", body, version: 8 }]);

    expect(choices.map(({ choiceId, sourceEntryId, label }) => ({ choiceId, sourceEntryId, label }))).toEqual([
      { choiceId: "P1", sourceEntryId: "legacy-main", label: "BEAUTY & STYLE EDUCATION" },
      { choiceId: "P2", sourceEntryId: "legacy-main", label: "TRANSFORMATION STORIES" },
      { choiceId: "P3", sourceEntryId: "legacy-main", label: "CLIENT PREPARATION" },
    ]);
    expect(choices[0]!.context).not.toContain("2. TRANSFORMATION STORIES");
  });

  it("supports duplicate generic legacy titles using first structured headings", () => {
    const choices = buildApprovedPillarChoices([
      { id: "legacy-a", title: "Additional content pillars", body: "TRANSFORMATION STORIES\n\nApproved guidance." },
      { id: "legacy-b", title: "Additional content pillars", body: "EDUCATIONAL CONTENT\n\nApproved guidance." },
    ]);
    expect(choices.map((choice) => [choice.choiceId, choice.sourceEntryId, choice.label])).toEqual([
      ["P1", "legacy-a", "TRANSFORMATION STORIES"],
      ["P2", "legacy-b", "EDUCATIONAL CONTENT"],
    ]);
  });

  it("keeps duplicate approved semantic headings distinct by choice ID", () => {
    const choices = buildApprovedPillarChoices([
      { id: "legacy-a", title: "Additional content pillars", body: "CLIENT STORIES\n\nApproved context A." },
      { id: "legacy-b", title: "Additional content pillars", body: "CLIENT STORIES\n\nApproved context B." },
    ]);
    expect(choices.map((choice) => [choice.choiceId, choice.sourceEntryId, choice.label])).toEqual([
      ["P1", "legacy-a", "CLIENT STORIES"],
      ["P2", "legacy-b", "CLIENT STORIES"],
    ]);
    expect(resolveApprovedPillarChoice(choices, "P1")?.sourceEntryId).toBe("legacy-a");
    expect(resolveApprovedPillarChoice(choices, "P2")?.sourceEntryId).toBe("legacy-b");
  });

  it("uses the approved entry as the honest broad fallback when no semantic section is safely derivable", () => {
    const choices = buildApprovedPillarChoices([{ id: "legacy", title: "Additional content pillars", body: "Ordinary prose without a structured heading." }]);
    expect(choices).toEqual([{ choiceId: "P1", sourceEntryId: "legacy", sourceEntryVersion: null, label: "Additional content pillars", context: "Ordinary prose without a structured heading." }]);
  });

  it("resolves only an exact identifier from the current request", () => {
    const choices = buildApprovedPillarChoices(modern);
    expect(resolveApprovedPillarChoice(choices, "P2")).toBe(choices[1]);
    expect(resolveApprovedPillarChoice(choices, "P3")).toBeNull();
    expect(resolveApprovedPillarChoice(choices, "p2")).toBeNull();
    expect(resolveApprovedPillarChoice(choices, "P2: Portrait preparation")).toBeNull();
    expect(resolveApprovedPillarChoice(choices, "org-a-entry-2")).toBeNull();
  });

  it("cannot resolve an identifier against another organisation's request choices", () => {
    const orgA = buildApprovedPillarChoices(modern);
    const orgB = buildApprovedPillarChoices([{ id: "org-b-entry", title: "Professional insight", body: "Approved B context." }]);
    expect(resolveApprovedPillarChoice(orgB, orgA[1]!.choiceId)).toBeNull();
  });

  it("excludes inactive entries before assigning request identifiers", () => {
    const choices = buildApprovedPillarChoices([
      { id: "inactive", title: "Inactive pillar", body: "Do not use.", status: "archived" },
      { id: "active", title: "Active pillar", body: "Approved context.", status: "active" },
    ]);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ choiceId: "P1", sourceEntryId: "active", label: "Active pillar" });
  });

  it("fails closed for malformed model identifiers", () => {
    const choices = buildApprovedPillarChoices(modern);
    for (const malformed of ["", "P0", "P-1", "P1 P2", "P999", "Creative portrait concepts"]) {
      expect(resolveApprovedPillarChoice(choices, malformed)).toBeNull();
    }
  });

  it("persists canonical source attribution and revalidates it in organisation scope", () => {
    const generationSource = readFileSync("src/server/actions/awo.ts", "utf8");
    const persistenceSource = readFileSync("src/server/actions/content.ts", "utf8");
    expect(generationSource).toContain("pillarSourceEntryId: operatorPillar ? null : analysedPillarChoice?.sourceEntryId");
    expect(generationSource).toContain("pillarSemanticLabel: selectedPillar");
    expect(persistenceSource).toContain("context.membrain.findEntry(draft.organisationId, attribution.pillarSourceEntryId)");
    expect(persistenceSource).toContain('sourceEntry.status !== "active"');
    expect(persistenceSource).toContain('sourceEntry.category?.key !== "content_pillars"');
    expect(persistenceSource).toContain('sourceType: "membrain_entry"');
  });
});
