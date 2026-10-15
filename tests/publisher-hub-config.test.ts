import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publisherHubConfig } from "@/infrastructure/publisher-hub/publisher-hub-config";
import { resolvePublisherHubClient } from "@/infrastructure/publisher-hub/http-publisher-hub-client";

const BASE_URL = "https://hub.example.com";
const HUB_KEY = "hub-operator-key"; // Dummy test value, never a real secret.

describe("publisherHubConfig", () => {
  beforeEach(() => {
    delete process.env.HUB_BASE_URL;
    delete process.env.HUB_API_KEY;
    // Regression guard: the Blotato credential must never satisfy the hub
    // config during (or after) the dual-run window.
    delete process.env.BLOTATO_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HUB_BASE_URL;
    delete process.env.HUB_API_KEY;
    delete process.env.BLOTATO_API_KEY;
  });

  it("reads HUB_API_KEY as the hub credential when set", () => {
    process.env.HUB_BASE_URL = `${BASE_URL}/`;
    process.env.HUB_API_KEY = ` ${HUB_KEY} `;

    expect(publisherHubConfig()).toEqual({ baseUrl: BASE_URL, apiKey: HUB_KEY });
  });

  it("returns null (not-configured) when HUB_API_KEY is unset, even with a base URL", () => {
    process.env.HUB_BASE_URL = BASE_URL;

    expect(publisherHubConfig()).toBeNull();
  });

  it("returns null when HUB_API_KEY is empty or whitespace-only", () => {
    process.env.HUB_BASE_URL = BASE_URL;
    process.env.HUB_API_KEY = "   ";

    expect(publisherHubConfig()).toBeNull();
  });

  it("never falls back to BLOTATO_API_KEY", () => {
    process.env.HUB_BASE_URL = BASE_URL;
    process.env.BLOTATO_API_KEY = "real-blotato-key";

    expect(publisherHubConfig()).toBeNull();
  });

  it("returns null without a base URL, even with HUB_API_KEY set", () => {
    process.env.HUB_API_KEY = HUB_KEY;

    expect(publisherHubConfig()).toBeNull();
  });

  it.each([
    "http://127.0.0.1:8080",
    "http://localhost:9000",
    "http://[::1]:9000",
  ])("fails closed on loopback base %s", (base) => {
    process.env.HUB_BASE_URL = base;
    process.env.HUB_API_KEY = HUB_KEY;

    expect(publisherHubConfig()).toBeNull();
  });
});

describe("resolvePublisherHubClient", () => {
  beforeEach(() => {
    process.env.HUB_BASE_URL = BASE_URL;
    process.env.HUB_API_KEY = HUB_KEY;
    delete process.env.BLOTATO_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HUB_BASE_URL;
    delete process.env.HUB_API_KEY;
    delete process.env.BLOTATO_API_KEY;
  });

  it("sends the HUB_API_KEY value in the blotato-api-key header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({ items: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const client = resolvePublisherHubClient();
    expect(client).not.toBeNull();

    await client?.listConnections();

    expect(capturedUrl).toBe(`${BASE_URL}/v2/oauth/accounts`);
    expect(capturedHeaders?.["blotato-api-key"]).toBe(HUB_KEY);
  });

  it("returns null (not-configured) instead of a client when HUB_API_KEY is unset", () => {
    delete process.env.HUB_API_KEY;
    process.env.BLOTATO_API_KEY = "real-blotato-key"; // no fallback, no wrong-key client

    expect(resolvePublisherHubClient()).toBeNull();
  });
});