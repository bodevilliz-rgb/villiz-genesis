import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalBaseUrl = process.env.BLOTATO_BASE_URL;

beforeEach(() => {
  delete process.env.BLOTATO_BASE_URL;
  vi.resetModules();
});

afterEach(() => {
  if (originalBaseUrl === undefined) {
    delete process.env.BLOTATO_BASE_URL;
  } else {
    process.env.BLOTATO_BASE_URL = originalBaseUrl;
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function listAccountsRequest() {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const { HttpBlotatoClient } = await import("@/infrastructure/blotato/http-blotato-client");
  await new HttpBlotatoClient("test-key").listAccounts();

  return fetchMock;
}

describe("HttpBlotatoClient base URL", () => {
  it("uses the self-hosted publisher hub by default", async () => {
    const fetchMock = await listAccountsRequest();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hermes.taile6522c.ts.net:10000/v2/users/me/accounts",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses BLOTATO_BASE_URL when configured", async () => {
    process.env.BLOTATO_BASE_URL = "http://publisher-hub:8000/v2";

    const fetchMock = await listAccountsRequest();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://publisher-hub:8000/v2/users/me/accounts",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
