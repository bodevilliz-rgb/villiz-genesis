import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  buildPickCaptionOptions,
  isMervicAlertEligible,
  verifyNativePostUrl,
} from "@/core/application/use-cases/picks-queue";
import type { MembrainContextItem } from "@/core/domain/entities/membrain";
import { HttpBlotatoClient } from "@/infrastructure/blotato/http-blotato-client";
import { queueMervicPublishAlert } from "@/infrastructure/alerts/twilio-mervic-alert";
import { parseWeeklyPackSources, selectInitialWeeklyPackItems } from "../scripts/weekly-pack-import-core";

const context: MembrainContextItem[] = [
  {
    id: "entry-1",
    title: "Brand voice",
    summary: "Clear, warm and useful.",
    body: "Help people choose with confidence.",
    importance: 5,
    categoryKey: "brand_voice",
    categoryLabel: "Brand voice",
    version: 1,
    updatedAt: "2026-10-12T00:00:00.000Z",
  },
  {
    id: "entry-2",
    title: "Audience",
    summary: "Busy owners who value practical guidance.",
    body: "Lead with the benefit and close with a simple invitation.",
    importance: 4,
    categoryKey: "audience",
    categoryLabel: "Audience",
    version: 1,
    updatedAt: "2026-10-12T00:00:00.000Z",
  },
];

describe("Picks Queue caption contract", () => {
  it("returns exactly three distinct, bounded options grounded in MemBrain context", () => {
    const options = buildPickCaptionOptions({ itemLabel: "Autumn portrait", context });
    expect(options).toHaveLength(3);
    expect(new Set(options).size).toBe(3);
    expect(options.every((option) => option.length > 0 && option.length <= 5000)).toBe(true);
    expect(options.join(" ")).toContain("Clear, warm and useful");
    expect(options.join(" ")).toContain("Help people choose with confidence");
  });
});

describe("Picks Queue approval migration", () => {
  it("restores approved status after the asset-link context trigger runs", () => {
    const migration = readFileSync("supabase/migrations/20261012123000_picks_queue.sql", "utf8");
    const link = migration.indexOf("insert into public.content_draft_assets");
    const reapproval = migration.indexOf("set status = 'approved'", link);
    expect(link).toBeGreaterThan(-1);
    expect(reapproval).toBeGreaterThan(link);
  });
});

describe("native-post verification", () => {
  it("fetches the supplied platform URL live before accepting a receipt", async () => {
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const result = await verifyNativePostUrl("instagram", "https://www.instagram.com/p/abc123/", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.publicUrl).toBe("https://www.instagram.com/p/abc123/");
    expect(result.receiptId).toMatch(/^native:/);
  });

  it("rejects a mismatched platform host and never fetches it", async () => {
    const fetcher = vi.fn();
    await expect(verifyNativePostUrl("instagram", "https://x.com/villiz/status/1", fetcher)).rejects.toThrow(
      /Instagram/i,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a URL that cannot be read successfully", async () => {
    await expect(
      verifyNativePostUrl("x", "https://x.com/villiz/status/1", async () => new Response("missing", { status: 404 })),
    ).rejects.toThrow(/live/i);
  });

  it("does not follow a platform redirect to an untrusted host", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/internal" },
    }));
    await expect(verifyNativePostUrl("instagram", "https://www.instagram.com/p/abc123/", fetcher)).rejects.toThrow(/Instagram/i);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("Blotato scheduled payload", () => {
  it("places scheduledTime at the top level, never inside post", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ postSubmissionId: "receipt-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpBlotatoClient("test-key");
    await client.publishPost({
      accountId: "account-1",
      platform: "instagram",
      text: "Caption",
      mediaUrls: ["https://blotato.example/media/1"],
      scheduledTime: "2026-10-21T18:00:00.000Z",
    });
    const init = (fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit])[1];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.scheduledTime).toBe("2026-10-21T18:00:00.000Z");
    expect((payload.post as Record<string, unknown>).scheduledTime).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe("Mervic alert gate", () => {
  it("queues only enabled Mervic publishes", () => {
    expect(isMervicAlertEligible("Mervic Signatures", true, false)).toBe(true);
    expect(isMervicAlertEligible("Mervic Signatures", false, false)).toBe(false);
    expect(isMervicAlertEligible("Mervic Signatures", true, true)).toBe(false);
    expect(isMervicAlertEligible("Villiz Pixels UK", true, false)).toBe(false);
  });

  it("does not enqueue the external alert contract for dry-runs or when the switch is off", async () => {
    const enqueue = vi.fn();
    await expect(queueMervicPublishAlert({
      organisationName: "Mervic Signatures",
      simulated: true,
      publicUrl: "https://www.instagram.com/p/one/",
      enqueue,
      enabled: true,
    })).resolves.toBe("ineligible");
    await expect(queueMervicPublishAlert({
      organisationName: "Mervic Signatures",
      simulated: false,
      publicUrl: "https://www.instagram.com/p/one/",
      enqueue,
      enabled: false,
    })).resolves.toBe("ineligible");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues one call_alerts.py event after a real enabled Mervic publish", async () => {
    const enqueue = vi.fn(async () => undefined);
    await expect(queueMervicPublishAlert({
      organisationName: "Mervic",
      simulated: false,
      publicUrl: "https://www.instagram.com/p/one/",
      enqueue,
      enabled: true,
    })).resolves.toBe("queued");
    expect(enqueue).toHaveBeenCalledOnce();
  });
});

describe("weekly pack parser", () => {
  it("deduplicates scan-state and pack-metadata entries by stable Drive source key", () => {
    const items = parseWeeklyPackSources(
      {
        seen: {
          driveA: { name: "One.png", brand: "Mervic", packed_as: "M1", status: "awaiting_approval" },
        },
        packs: {
          packA: {
            owner_pack_numbering: {
              "1": { card: "One.png", message: "A clear choice", option_1: "One", option_2: "Two", option_3: "Three" },
            },
          },
        },
      },
      [
        { id: "driveA", name: "One.png", brand: "Mervic" },
        { id: "driveB", name: "Two.png", brand: "Villiz" },
      ],
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.sourceKey).toBe("drive:driveA");
    expect(items[0]?.captionOptions).toEqual(["One", "Two", "Three"]);
    expect(items[1]?.sourceKey).toBe("drive:driveB");
  });

  it("selects exactly the initial 10 Mervic and 4 Villiz approval items", () => {
    const make = (brand: string, count: number) => Array.from({ length: count }, (_, index) => ({
      sourceKey: `${brand}-${index}`, driveFileId: `${brand}-${index}`, fileName: `${brand}${index}.png`,
      brand, itemLabel: `${brand}${index}`, captionOptions: [], slotTime: null,
      metadata: { status: "awaiting_approval" },
    }));
    const selected = selectInitialWeeklyPackItems([...make("Mervic", 12), ...make("Villiz", 6)]);
    expect(selected).toHaveLength(14);
    expect(selected.filter((item) => item.brand === "Mervic")).toHaveLength(10);
    expect(selected.filter((item) => item.brand === "Villiz")).toHaveLength(4);
  });
});
