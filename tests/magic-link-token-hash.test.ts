import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.fn();

vi.mock("@/infrastructure/supabase/server-client", () => ({
  createGenesisClient: vi.fn(async () => ({
    auth: { verifyOtp },
    from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) })),
  })),
}));

function makeRequest(params: Record<string, string>): NextRequest {
  const search = new URLSearchParams(params);
  return new NextRequest(`https://villiz-genesis.vercel.app/auth/confirm${search.toString() ? `?${search}` : ""}`);
}

function responseLocation(response: Response): string {
  return response.headers.get("location") ?? "";
}

describe("GET /auth/confirm (token-hash magic link)", () => {
  beforeEach(() => verifyOtp.mockReset());

  it("redirects to the safe next path after a successful verification", async () => {
    verifyOtp.mockResolvedValue({ error: null, data: { user: { id: "user-1" } } });
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(makeRequest({ token_hash: "tok-1", type: "magiclink", next: "/picks" }));

    expect(responseLocation(response)).toBe("https://villiz-genesis.vercel.app/picks");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "tok-1" });
  });

  it("rejects an unsafe next path", async () => {
    verifyOtp.mockResolvedValue({ error: null, data: { user: { id: "user-1" } } });
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(makeRequest({ token_hash: "tok-1", type: "magiclink", next: "https://evil.example.com" }));

    expect(responseLocation(response)).not.toContain("evil.example.com");
  });

  it("redirects to the expired page when the token is unknown or already used", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" }, data: { user: null } });
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(makeRequest({ token_hash: "tok-1", type: "magiclink" }));

    expect(responseLocation(response)).toBe("https://villiz-genesis.vercel.app/auth/error?reason=expired");
    expect(responseLocation(response)).not.toContain("Token has expired");
  });

  it("never exposes the provider error message", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Email rate limit exceeded: internal provider detail" }, data: { user: null } });
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(makeRequest({ token_hash: "tok-1", type: "magiclink" }));

    expect(responseLocation(response)).toBe("https://villiz-genesis.vercel.app/auth/error?reason=expired");
  });

  it("redirects to the expired page when token_hash is missing", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(makeRequest({}));

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(responseLocation(response)).toBe("https://villiz-genesis.vercel.app/auth/error?reason=expired");
  });
});