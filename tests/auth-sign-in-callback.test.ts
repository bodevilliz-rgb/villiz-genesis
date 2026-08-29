import { describe, expect, it } from "vitest";
import {
  resolveSignInCallbackUrl,
  STABLE_GENESIS_PREVIEW_ORIGIN,
} from "@/lib/auth-callback-url";

const canonical = "https://villiz-genesis.vercel.app";

describe("resolveSignInCallbackUrl", () => {
  it("accepts the configured canonical origin", () => {
    expect(resolveSignInCallbackUrl({ requestOrigin: canonical, canonicalSiteUrl: canonical, nodeEnv: "production" }))
      .toBe(`${canonical}/auth/callback`);
  });

  it("accepts the one stable preview origin", () => {
    expect(resolveSignInCallbackUrl({
      requestOrigin: STABLE_GENESIS_PREVIEW_ORIGIN,
      canonicalSiteUrl: canonical,
      nodeEnv: "production",
    })).toBe(`${STABLE_GENESIS_PREVIEW_ORIGIN}/auth/callback`);
  });

  it.each([
    "https://villiz-genesis-git-untrusted.vercel.app",
    "https://evil.example.com",
    "http://villiz-genesis.vercel.app",
    "not a URL",
  ])("falls back to canonical for an unauthorised origin: %s", (requestOrigin) => {
    expect(resolveSignInCallbackUrl({ requestOrigin, canonicalSiteUrl: `${canonical}/`, nodeEnv: "production" }))
      .toBe(`${canonical}/auth/callback`);
  });

  it("allows localhost HTTP only outside production", () => {
    expect(resolveSignInCallbackUrl({
      requestOrigin: "http://localhost:3000",
      canonicalSiteUrl: canonical,
      nodeEnv: "development",
    })).toBe("http://localhost:3000/auth/callback");
  });

  it("rejects localhost HTTP in production", () => {
    expect(resolveSignInCallbackUrl({
      requestOrigin: "http://localhost:3000",
      canonicalSiteUrl: canonical,
      nodeEnv: "production",
    })).toBe(`${canonical}/auth/callback`);
  });
});
