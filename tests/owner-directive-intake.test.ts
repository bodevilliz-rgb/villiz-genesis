/**
 * GEN-PUB-A intake contract tests — the three owner-message round trips are
 * the task's exit criterion. The parser is pure: these tests prove the exact
 * mapping (client, asset, platforms, GMT-default schedule, caption source,
 * hashtag auto-trim, GEN-LIVE-1 declarations) and every fail-closed stop.
 *
 * Provenance of expected values:
 * - Instagram maxHashtags=5 → provider-verified live 422 (platform-policy.ts).
 * - GMT default → standing owner default; stored as Etc/GMT instant +
 *   explicit timezone string, matching createScheduledPublishingJob input
 *   (scheduledFor UTC instant, timezone IANA string).
 * - GEN-LIVE-1 declaration precedent → certified production lane record.
 * - composePublishedText appends ONLY first-class hashtags — captions in
 *   these tests never contain '#' (P0 422 root cause).
 */
import { describe, expect, it } from "vitest";
import {
  applyHashtagPolicy,
  deriveAiBrandDeclaration,
  extractApprovalPhrase,
  extractAssetNoun,
  extractClientName,
  extractContentRef,
  extractDriveFolderRef,
  extractKeptSetOverride,
  extractPlatformTokens,
  extractScheduleDate,
  extractUnknownPlatformTokens,
  isSchedulable,
  parseOwnerDirective,
} from "@/core/application/use-cases/intake/owner-directive";

const NOW = "2026-10-02T12:00:00.000Z";
const CLIENT_INDEX: Record<string, string> = { "Alpha Homes": "Alpha-Homes Oct", "X Consulting": "X-Consulting Oct" };
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

describe("platform token extraction", () => {
  it("detects preposition-bound platform words", () => {
    expect(extractPlatformTokens("post the flier on IG and TikTok")).toEqual(["instagram", "tiktok"]);
    expect(extractPlatformTokens("queue to Facebook, via Linkedin")).toEqual(["facebook", "linkedin"]);
  });

  it("never mistakes the client name 'X' for the X platform", () => {
    expect(extractPlatformTokens("post client X flier on 14 Oct")).toEqual([]);
  });

  it("parses the operator shorthand clause", () => {
    expect(extractPlatformTokens("platforms: instagram, tiktok | schedule the set 2026-10-14")).toEqual([
      "instagram",
      "tiktok",
    ]);
  });

  it("surfaces explicitly stated unknown platform names instead of silently dropping them", () => {
    expect(extractUnknownPlatformTokens("platforms: bebo, instagram")).toEqual(["bebo"]);
    expect(extractUnknownPlatformTokens("platforms: instagram")).toEqual([]);
    expect(extractUnknownPlatformTokens("post the flier 14 Oct")).toEqual([]);
  });
});

describe("client + asset extraction", () => {
  it("extracts indexed clients and strips index-matched suffix words", () => {
    expect(extractClientName("post client Alpha Homes flier 14 Oct", CLIENT_INDEX)).toBe("Alpha Homes");
  });

  it("returns the bare name for an unknown client (stops as unknown_client)", () => {
    expect(extractClientName("post client Delta flier 14 Oct", CLIENT_INDEX)).toBe("Delta");
  });

  it("extracts content and folder refs", () => {
    expect(extractContentRef('post content "Grand Opening Flier — October" 2026-10-14')).toBe("Grand Opening Flier — October");
    expect(extractDriveFolderRef("schedule fliers from Drive folder Y 2026-10-21 09:15")).toBe("Y");
    expect(extractDriveFolderRef("schedule the set from folder Alpha-Homes Oct")).toBe("Alpha-Homes Oct");
  });

  it("never swallows a trailing platforms clause or preposition-platform tail into the folder name", () => {
    // QA round-1 blocking finding #1: the capture was "Y platforms", the explicit
    // instagram clause was lost to the silent default, and a mapped folder
    // surfaced a spurious unknown_client stop.
    expect(extractDriveFolderRef("schedule fliers from folder Y platforms: instagram 2026-10-21 09:15")).toBe("Y");
    expect(extractDriveFolderRef("schedule fliers from folder Y on instagram 2026-10-21")).toBe("Y");
    expect(extractDriveFolderRef("schedule fliers from folder Y to tiktok")).toBe("Y");
    expect(extractDriveFolderRef("schedule the set from folder launch-on-ig-raw")).toBe("launch-on-ig-raw");
  });

  it("extracts the asset noun for both owner phrasings", () => {
    expect(extractAssetNoun("post client X flier 14 Oct")).toBe("flier");
    expect(extractAssetNoun("post a flier for client X on 14 Oct")).toBe("flier");
    expect(extractAssetNoun('publish content "Grand Opening" 2026-10-14')).toBeNull();
  });

  it("scans approval phrases longest-first", () => {
    expect(extractApprovalPhrase("approved to send")).toBe("approved to send");
    expect(extractApprovalPhrase("send it")).toBe("send it");
    expect(extractApprovalPhrase("no approval here")).toBeNull();
  });

  it("reads in-message kept-set overrides", () => {
    expect(extractKeptSetOverride("kept hashtag set: #AlphaHomes #London\n14 Oct")).toEqual([
      "AlphaHomes",
      "London",
    ]);
  });
});

describe("schedule parsing (GMT default)", () => {
  function scheduledForOf(message: string): string {
    const result = extractScheduleDate(message, NOW);
    if ("error" in result) throw new Error(`expected a parsed schedule, got ${result.error}: ${result.message}`);
    return result.scheduledFor;
  }

  it("parses '14 Oct' with the 09:00 default under Etc/GMT", () => {
    expect(extractScheduleDate("post client X flier 14 Oct", NOW)).toEqual({
      timezone: "Etc/GMT",
      scheduledFor: "2026-10-14T09:00:00.000Z",
      source: "default",
      requestedWallClock: "2026-10-14 09:00",
    });
  });

  it("parses explicit clock times including pm and dot-separated forms", () => {
    expect(scheduledForOf("schedule the set from folder Y 2026-10-21 09:15")).toBe("2026-10-21T09:15:00.000Z");
    expect(scheduledForOf("post the flier 15 Oct 9.30pm")).toBe("2026-10-15T21:30:00.000Z");
    expect(scheduledForOf("post the flier 15 Oct 09:15 pm")).toBe("2026-10-15T21:15:00.000Z");
  });

  it("rejects year-less past dates, impossible dates and missing dates", () => {
    const past = extractScheduleDate("post it 1 Jan", NOW);
    expect("error" in past && past.error).toBe("past_date");
    expect("error" in past && past.message).toContain("State the year explicitly");
    expect(extractScheduleDate("post it 31 Feb", NOW)).toMatchObject({ error: "unparseable_date" });
    expect(extractScheduleDate("post it sometime", NOW)).toMatchObject({ error: "unparseable_date" });
    // An explicit year disambiguates and parses cleanly.
    expect(scheduledForOf("post it 1 Jan 2027")).toBe("2027-01-01T09:00:00.000Z");
  });

  it("tomorrow/today resolve relative to the clock", () => {
    expect(scheduledForOf("post it tomorrow")).toBe("2026-10-03T09:00:00.000Z");
  });
});

describe("hashtag policy", () => {
  it("auto-trims IG to 5 keeping the head of the owner-ordered set", () => {
    expect(applyHashtagPolicy("instagram", KEPT)).toEqual({
      autoTrimmed: true,
      final: ["AlphaHomes", "London", "Property", "Listing", "Launch"],
      dropped: ["Interior"],
      count: 5,
      platformLimit: 5,
      withinLimit: true,
    });
  });

  it("never invents limits: TikTok keeps the richer set untouched", () => {
    const result = applyHashtagPolicy("tiktok", [...KEPT, "FYP", "LondonProperty", "LaunchDay", "New"]);
    expect(result.autoTrimmed).toBe(false);
    expect(result.final).toHaveLength(10); // 6 KEPT + 4 extra — TikTok keeps the richer set untouched
    expect(result.platformLimit).toBeNull();
    expect(result.withinLimit).toBe(true);
  });

  it("keeps IG inside the limit without trimming when the set is small", () => {
    const result = applyHashtagPolicy("instagram", ["AlphaHomes", "London"]);
    expect(result).toMatchObject({ autoTrimmed: false, count: 2, platformLimit: 5, withinLimit: true });
  });
});

describe("AI/brand declarations", () => {
  it("applies the GEN-LIVE-1 certified-lane precedent", () => {
    expect(deriveAiBrandDeclaration("tiktok")).toEqual({
      isAiGenerated: true,
      isYourBrand: true,
      isBrandedContent: false,
      source: "gen_live_1_precedent",
    });
  });

  it("owner statement overrides the precedent", () => {
    expect(deriveAiBrandDeclaration("tiktok", { isBrandedContent: true }).source).toBe("owner_statement");
  });
});

describe("round trip 1 — 'post client X flier 14 Oct'", () => {
  const job = parseOwnerDirective(baseInput("post client Alpha Homes flier 14 Oct"));

  it("maps client, asset, default platform and GMT schedule", () => {
    expect(job.client).toEqual({ clientName: "Alpha Homes", source: "message" });
    expect(job.asset).toMatchObject({ kind: "client_asset_index", ref: "flier", resolvedAssetIds: null });
    expect(job.platforms).toEqual(["instagram"]);
    expect(job.schedule.timezone).toBe("Etc/GMT");
    expect(job.schedule.scheduledFor).toBe("2026-10-14T09:00:00.000Z");
  });

  it("auto-trims kept set to the IG limit and applies the GEN-LIVE-1 precedent", () => {
    expect(job.hashtags?.instagram).toMatchObject({ autoTrimmed: true, count: 5, platformLimit: 5, dropped: ["Interior"] });
    expect(job.aiBrandDeclarations?.instagram).toEqual({
      isAiGenerated: true,
      isYourBrand: true,
      isBrandedContent: false,
      source: "gen_live_1_precedent",
    });
  });

  it("stops fail-closed on the unresolved asset and on caption approval — never schedules silently", () => {
    expect(job.stops.map((s) => s.code).sort()).toEqual(["caption_requires_approval", "no_resolved_asset"]);
    expect(job.stops.every((s) => s.pendingOwnerDecisions.length > 0)).toBe(true);
    expect(job.contentApproval).toBeNull();
    expect(job.caption).toEqual({ kind: "drafted", value: null, requiresApproval: true });
    expect(isSchedulable(job)).toBe(false);
  });
});

describe("round trip 2 — 'schedule fliers from Drive folder Y 2026-10-21 09:15'", () => {
  it("unknown folder → fail-closed unknown_client stop naming the mapping decision", () => {
    const job = parseOwnerDirective(baseInput("schedule fliers from Drive folder Y 2026-10-21 09:15"));
    expect(job.asset).toMatchObject({ kind: "drive_folder", ref: "Y", resolvedAssetIds: null });
    expect(job.schedule.scheduledFor).toBe("2026-10-21T09:15:00.000Z");
    expect(job.schedule.source).toBe("explicit");
    expect(job.client).toBeNull();
    expect(job.stops.map((s) => s.code)).toEqual(["unknown_client", "caption_requires_approval"]);
    expect(job.stops[0]?.pendingOwnerDecisions).toEqual(["Map Drive folder 'Y' to a client in the kept index."]);
    expect(isSchedulable(job)).toBe(false);
  });

  it("indexed folder resolves client + approval via the kept index and card record", () => {
    const approved = parseOwnerDirective({
      message: "schedule fliers from Drive folder Alpha-Homes Oct 2026-10-21 09:15",
      now: NOW,
      keptHashtags: KEPT,
      clientIndex: CLIENT_INDEX,
      existingApproval: {
        phrase: "send it",
        decidedAt: "2026-10-01T10:00:00.000Z",
        campaignCardId: "t_alpha_homes_campaign",
        record: "campaign_card",
      },
    });
    expect(approved.client).toEqual({ clientName: "Alpha Homes", source: "asset_index" });
    expect(approved.contentApproval).toMatchObject({ record: "campaign_card", phrase: "send it" });
    expect(approved.stops).toEqual([]);
  });
});

describe("round trip 3 — content + approval + platform list", () => {
  const message = 'post content "Grand Opening Flier — October" for client Alpha Homes on IG and TikTok 2026-10-15 18:00 approved to send kept hashtag set: AlphaHomes, London';
  const job = parseOwnerDirective(baseInput(message));

  it("parses verbatim content, dual platforms and the explicit GMT time", () => {
    expect(job.asset.kind).toBe("content");
    expect(job.asset.ref).toBe("Grand Opening Flier — October");
    expect(job.platforms).toEqual(["instagram", "tiktok"]);
    expect(job.schedule.scheduledFor).toBe("2026-10-15T18:00:00.000Z");
  });

  it("attaches the in-message approval to the campaign asset record", () => {
    expect(job.contentApproval).toMatchObject({ phrase: "approved to send", record: "in_message", campaignCardId: null });
    expect(job.caption).toMatchObject({ kind: "provided", requiresApproval: false });
  });

  it("IG auto-trims the override set; TikTok keeps it richer; declarations carry the precedent", () => {
    expect(job.hashtags?.instagram?.final).toEqual(["AlphaHomes", "London"]);
    expect(job.hashtags?.tiktok?.autoTrimmed).toBe(false);
    expect(job.aiBrandDeclarations?.tiktok).toEqual({
      isAiGenerated: true,
      isYourBrand: true,
      isBrandedContent: false,
      source: "gen_live_1_precedent",
    });
    expect(job.stops).toEqual([]);
  });

  it("is schedulable once asset resolution fills the resolved assets (stop-free contract)", () => {
    expect(isSchedulable(job)).toBe(false); // resolvedAssetIds: null until the asset-resolution lane runs
    const resolved = { ...job, asset: { ...job.asset, resolvedAssetIds: ["asset-1"] } };
    expect(isSchedulable(resolved)).toBe(true);
  });
});

describe("fail-closed stops", () => {
  it("unknown client stops with a mapping decision", () => {
    const job = parseOwnerDirective(baseInput("post client Delta flier 14 Oct"));
    expect(job.stops.map((s) => s.code)).toContain("unknown_client");
    expect(isSchedulable(job)).toBe(false);
  });

  it("both content and folder in one message is ambiguous", () => {
    const job = parseOwnerDirective(
      baseInput('post content "Flier 1" from Drive folder Alpha-Homes Oct 2026-10-14'),
    );
    expect(job.asset.kind).toBe("drive_folder");
    expect(job.stops.map((s) => s.code)).toContain("ambiguous_asset");
  });

  it("past-date schedules are refused", () => {
    const job = parseOwnerDirective(baseInput("post client Alpha Homes flier 14 Oct"));
    const past = parseOwnerDirective(baseInput("post client Alpha Homes flier 1 Sep"));
    expect(past.stops.map((s) => s.code)).toContain("past_date");
    expect(job.stops.map((s) => s.code)).not.toContain("past_date");
  });
});

describe("fail-closed regressions — QA round 1 (t_1b518c6f)", () => {
  it("folder + 'platforms:' clause: the clause survives and the mapped folder still maps", () => {
    const job = parseOwnerDirective(
      baseInput("schedule fliers from folder Y platforms: instagram 2026-10-21 09:15", {
        clientIndex: { "Alpha Homes": "Y" },
      }),
    );
    expect(job.asset.ref).toBe("Y");
    expect(job.platforms).toEqual(["instagram"]); // the stated clause, not the silent default
    expect(job.stops.map((s) => s.code)).not.toContain("unknown_client"); // folder→client index resolves it
  });

  it("unknown operator-clause platform stops instead of silently defaulting to instagram", () => {
    const job = parseOwnerDirective(baseInput("post client Alpha Homes flier platforms: bebo 14 Oct"));
    expect(job.stops.map((s) => s.code)).toContain("unknown_platform");
    expect(job.stops.find((s) => s.code === "unknown_platform")?.pendingOwnerDecisions[0]).toContain("bebo");
    expect(isSchedulable(job)).toBe(false);
  });
});