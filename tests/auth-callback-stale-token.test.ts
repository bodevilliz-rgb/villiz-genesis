import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { GET } from "@/app/auth/callback/route";
import AuthErrorPage from "@/app/auth/error/page";
import { describeAuthErrorReason, AUTH_ERROR_REASONS } from "@/lib/auth-error-reasons";
import { isStaleTokenError } from "@/lib/auth-stale-token";
import { routes } from "@/lib/routes";

const supabase = vi.hoisted(() => ({
  auth: {
    exchangeCodeForSession: vi.fn(),
    getUser: vi.fn(),
  },
  from: vi.fn(),
}));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  createGenesisClient: vi.fn(async () => supabase),
}));

const STALE_ERROR = {
  code: "otp_expired",
  status: 403,
  message: "One-time token not found",
} as const;

const callbackUrl = (query: string) => `https://genesis.local/auth/callback?${query}`;

async function runCallback(query: string) {
  return GET(new Request(callbackUrl(query)) as never);
}

const locationOf = (response: Response) => response.headers.get("location");

describe("auth callback stale-token handling", () => {
  beforeEach(() => {
    supabase.auth.exchangeCodeForSession.mockReset();
    supabase.auth.getUser.mockReset();
  });

  it("retries an already-signed-in visitor into the validated next path when the one-time code is consumed", async () => {
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ error: STALE_ERROR });
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });

    const response = await runCallback("code=used-code&next=/settings/connections");

    expect(locationOf(response)).toBe("https://genesis.local/settings/connections");
    expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("retries an already-signed-in visitor to the dashboard when next is missing", async () => {
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ error: STALE_ERROR });
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });

    const response = await runCallback("code=used-code");

    expect(locationOf(response)).toBe("https://genesis.local/dashboard");
  });

  it("sends a stale code with no live session to /auth/error with the expired reason", async () => {
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ error: STALE_ERROR });
    supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await runCallback("code=used-code&next=/dashboard");

    expect(locationOf(response)).toBe("https://genesis.local/auth/error?reason=expired");
  });

  it("does not probe a session for genuine (non-stale) exchange failures", async () => {
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "fetch failed" } });

    const response = await runCallback("code=broken-code");

    expect(locationOf(response)).toBe("https://genesis.local/auth/error?reason=expired");
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it("keeps redirecting missing-code requests to the client invitation-acceptance page", async () => {
    const response = await runCallback("next=/dashboard");

    expect(locationOf(response)).toBe("https://genesis.local/auth/accept");
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("isStaleTokenError (consumed one-time code classifier)", () => {
  it("matches the consumed one-time-code classes observed in production and on the dev stack", () => {
    expect(isStaleTokenError({ code: "otp_expired", message: "The OTP code has been used" })).toBe(true);
    expect(isStaleTokenError({ message: "One-time token not found" })).toBe(true);
    expect(isStaleTokenError({
      code: "flow_state_not_found",
      message: "invalid flow state, no valid flow state found",
    })).toBe(true);
    expect(isStaleTokenError({
      code: "pkce_code_verifier_not_found",
      message: "PKCE code verifier not found in storage.",
    })).toBe(true);
    expect(isStaleTokenError({ message: "invalid request: token has expired" })).toBe(true);
  });

  it("does not treat unrelated auth failures as consumed-link errors", () => {
    expect(isStaleTokenError(null)).toBe(false);
    expect(isStaleTokenError(undefined)).toBe(false);
    expect(isStaleTokenError({})).toBe(false);
    expect(isStaleTokenError({ code: "bad_jwk", message: "Network request failed" })).toBe(false);
    expect(isStaleTokenError({ code: "credentials_sign_failed", message: "Invalid login credentials" }))
      .toBe(false);
  });
});

describe("auth error reason map (copy contract)", () => {
  it("describes the single-use nature of sign-in links without promising a lifetime", () => {
    expect(describeAuthErrorReason("expired")).toBe(AUTH_ERROR_REASONS.expired);
    expect(AUTH_ERROR_REASONS.expired)
      .toBe("Sign-in links are single-use and expire quickly. Open the newest sign-in email and tap its link once.");
    expect(AUTH_ERROR_REASONS.expired).not.toMatch(/hour/i);
  });

  it("keeps the incomplete-link copy stable", () => {
    expect(describeAuthErrorReason("missing_code")).toBe(AUTH_ERROR_REASONS.missing_code);
    expect(AUTH_ERROR_REASONS.missing_code)
      .toBe("That link is incomplete. Open the most recent email and use the button inside it.");
  });

  it("falls back for unknown or missing reasons", () => {
    expect(describeAuthErrorReason(undefined)).toBe("Something interrupted the sign-in. Request a new link and try again.");
    expect(describeAuthErrorReason(null)).toBe("Something interrupted the sign-in. Request a new link and try again.");
    expect(describeAuthErrorReason("mystery")).toBe("Something interrupted the sign-in. Request a new link and try again.");
  });
});

describe("/auth/error page", () => {
  const renderErrorPage = async (reason?: string) => {
    const element: ReactElement = await AuthErrorPage({
      searchParams: Promise.resolve(reason === undefined ? {} : { reason }),
    });
    return renderToStaticMarkup(element);
  };

  it("shows the accurate single-use copy for a stale link", async () => {
    const html = await renderErrorPage("expired");

    expect(html).toContain("Sign-in links are single-use and expire quickly.");
    expect(html).not.toMatch(/hour/i);
    expect(html).toContain("Request a new link");
  });

  it("keeps the request-a-new-link button for plain errors", async () => {
    const html = await renderErrorPage("missing_code");

    expect(html).toContain("That link is incomplete. Open the most recent email and use the button inside it.");
    expect(html).toContain(`href="${routes.login}"`);
    expect(html).toContain("Request a new link");
  });
});