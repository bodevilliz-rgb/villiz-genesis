/*
 * EPHEMERAL QA harness — card t_1b518c6f correction cycle, QA round-1 probes.
 * Reproduced in <script> against the live source, then verified fixed at HEAD
 * (adaaa9a). Deleted immediately after the evidence run — never part of the
 * shipped suite.
 */
import { describe, expect, it } from "vitest";
import {
  extractAssetNoun,
  extractDriveFolderRef,
  parseOwnerDirective,
} from "@/core/application/use-cases/intake/owner-directive";

const CLIENT_INDEX = { "Alpha Homes": "Alpha-Homes Oct", Genesis: "Y" };
const NOW = "2026-10-02T12:00:00.000Z";
const base = (message: string) => ({ message, now: NOW, keptHashtags: [], clientIndex: CLIENT_INDEX, existingApproval: null });

describe("QA round-1 blocking probes (card t_1b518c6f)", () => {
  it("probe 1 — folder name does not swallow the platforms clause; stop set is clean", () => {
    const message = "schedule fliers from folder Y platforms: instagram 2026-10-21";
    expect(extractDriveFolderRef(message)).toBe("Y");
    expect(extractAssetNoun(message)).toBe("fliers");
    const job = parseOwnerDirective(base(message));
    expect(job.stops.map((s) => s.code)).not.toContain("unknown_client");
    expect(job.platforms).toEqual(["instagram"]);
  });

  it("probe 2 — explicitly stated unknown platform fires the real unknown_platform stop", () => {
    const job = parseOwnerDirective(base("schedule fliers from folder Alpha-Homes Oct platforms: bebo 2026-10-21"));
    expect(job.stops.map((s) => s.code)).toContain("unknown_platform");
    expect(job.stops.find((s) => s.code === "unknown_platform")?.message).toBe(
      "Platform 'bebo' is outside the five supported publishing platforms (Instagram, Facebook, LinkedIn, X, TikTok).",
    );
  });

  it("probe 3 — known platforms still normalise through the explicit clause", () => {
    const job = parseOwnerDirective(base("schedule fliers from folder Alpha-Homes Oct platforms: instagram, tiktok 2026-10-21"));
    expect(job.platforms).toEqual(["instagram", "tiktok"]);
    expect(job.stops.map((s) => s.code)).not.toContain("unknown_platform");
  });

  it("probe 4 — legacy shapes and bare platform words unchanged (regression guard)", () => {
    expect(extractDriveFolderRef("schedule the set from folder Alpha-Homes Oct 2026-10-21 09:15")).toBe("Alpha-Homes Oct");
    expect(parseOwnerDirective(base("post client Alpha Homes flier 14 Oct")).platforms).toEqual(["instagram"]);
  });
});