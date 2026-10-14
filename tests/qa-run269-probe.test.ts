import { describe, expect, it } from "vitest";
import {
  extractDriveFolderRef,
  extractPlatformTokens,
  extractUnknownPlatformTokens,
  parseOwnerDirective,
} from "@/core/application/use-cases/intake/owner-directive";
import { isPublishingPlatform } from "@/core/domain/entities/publishing";

const NOW = "2026-10-02T12:00:00.000Z";
const CLIENT_INDEX: Record<string, string> = { "Alpha Homes": "Alpha Homes Oct", Genesis: "Y" };
const KEPT = ["AlphaHomes", "London", "Property", "Listing", "Launch", "Interior"];
function baseInput(message: string, overrides: Partial<{ keptHashtags: string[]; clientIndex: Record<string, string> }> = {}) {
  return {
    message,
    now: NOW,
    keptHashtags: overrides.keptHashtags ?? KEPT,
    clientIndex: overrides.clientIndex ?? CLIENT_INDEX,
    existingApproval: null,
  };
}

describe("QA run-269 probes @ a78550ac (merged tree)", () => {
  it("run1 repro: folder clause not swallowed + real unknown_platform stop fires", () => {
    expect(extractDriveFolderRef === undefined).toBe(false);
    expect(extractDriveFolderRef("schedule fliers from folder Y platforms: instagram 2026-10-21")).toBe("Y");
    expect(extractDriveFolderRef("schedule fliers from folder Y on instagram 2026-10-21")).toBe("Y");
    expect(extractDriveFolderRef("schedule fliers from folder Y to tiktok")).toBe("Y");
  });

  it("run1 repro: unknown platform name surfaces — live parse stops with unknown_platform", () => {
    const job = parseOwnerDirective(baseInput("schedule fliers from folder Alpha Homes Oct platforms: bebo 2026-10-21"));
    expect(job.stops.map((s) => s.code)).toContain("unknown_platform");
    expect(job.stops.find((s) => s.code === "unknown_platform")?.message).toBe(
      "Platform 'bebo' is outside the five supported publishing platforms (Instagram, Facebook, LinkedIn, X, TikTok).",
    );
  });

  it("regression: mapped folder + live parse gives exactly one gate stop", () => {
    const job = parseOwnerDirective(baseInput("schedule fliers from folder Y platforms: instagram 2026-10-21"));
    expect(job.stops.map((s) => s.code)).toEqual(["caption_requires_approval"]);
    expect(job.platforms).toEqual(["instagram"]);
    expect(job.asset.ref).toBe("Y");
  });

  it("GMT default: no clock stated -> scheduledFor 2026-10-21T09:00:00.000Z", () => {
    const job = parseOwnerDirective(baseInput("schedule fliers from folder Y platforms: instagram 2026-10-21"));
    expect(job.schedule.scheduledFor).toBe("2026-10-21T09:00:00.000Z");
    expect(job.schedule.timezone).toBe("Etc/GMT");
    expect(job.stops.find((s) => s.code === "unparseable_date")).toBeUndefined();
  });

  it("mixed known+unknown: parse continues, valid platform kept", () => {
    const unknown = extractUnknownPlatformTokens("platforms: bebo, instagram");
    expect(unknown).toEqual(["bebo"]);
    const job = parseOwnerDirective(baseInput("post the flier platforms: instagram, bebo 14 Oct"));
    expect(job.platforms).toEqual(["instagram"]);
    expect(job.stops.map((s) => s.code)).toContain("unknown_platform");
  });

  it("explicit clause overrides default platform", () => {
    const job = parseOwnerDirective(baseInput("schedule fliers from folder Y platforms: tiktok 2026-10-21"));
    expect(job.platforms).toEqual(["tiktok"]);
  });

  it("bare platform word ignored; platform token extraction sane under folder syntax", () => {
    expect(extractPlatformTokens("post client Alpha Homes flier 14 Oct")).toEqual([]);
    expect(extractPlatformTokens("schedule fliers from folder Y on instagram")).toEqual(["instagram"]);
  });

  it("edge stress: multiword folder + to-platform tail; folder genuinely ending in 'platforms' fails closed", () => {
    const job = parseOwnerDirective(baseInput("schedule fliers from folder Alpha Homes Oct to tiktok 2026-10-21"));
    expect(job.asset.ref).toBe("Alpha Homes Oct");
    expect(job.platforms).toEqual(["tiktok"]);
    expect(job.stops.map((s) => s.code)).not.toContain("unknown_client");
    const job2 = parseOwnerDirective(baseInput("schedule fliers from folder Alpha Homes platforms to tiktok"));
    expect(job2.asset.ref).toBe("Alpha Homes platforms");
    expect(job2.stops.map((s) => s.code)).toContain("unknown_client");
  });

  it("regression: schedulability helpers", () => {
    expect(isPublishingPlatform("instagram")).toBe(true);
    expect(isPublishingPlatform("bebo")).toBe(false);
  });

  it("caption gate: always present, requires approval, exact message", () => {
    const job = parseOwnerDirective(baseInput("schedule fliers from folder Y platforms: instagram 2026-10-21"));
    expect(job.stops[0]?.code).toBe("caption_requires_approval");
    expect(job.stops[0]?.gate).toBe("caption_approval");
  });
});
