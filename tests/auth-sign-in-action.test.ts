import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "https://villiz-genesis-agie-preview.vercel.app" })),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  createGenesisClient: vi.fn(async () => ({ auth: { signInWithOtp, signOut: vi.fn() } })),
}));

vi.mock("@/lib/env", () => ({
  isAllowedEmail: (email: string) => email.endsWith("@villiz.com"),
  allowedEmailDomains: () => ["villiz.com"],
  serverEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://villiz-genesis.vercel.app" }),
}));

describe("requestSignInLink", () => {
  beforeEach(() => signInWithOtp.mockReset());

  it("reports confirmed provider delivery acceptance as success", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    const { requestSignInLink } = await import("@/server/actions/auth");
    const form = new FormData();
    form.set("email", "operator@villiz.com");

    const result = await requestSignInLink({ status: "idle", message: "" }, form);

    expect(result).toEqual({ status: "success", message: "Check your inbox. The link is valid for one hour." });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "operator@villiz.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://villiz-genesis-agie-preview.vercel.app/auth/callback",
      },
    });
  });

  it("shows an actionable generic error when Supabase does not accept delivery", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "Email rate limit exceeded: internal provider detail" } });
    const { requestSignInLink } = await import("@/server/actions/auth");
    const form = new FormData();
    form.set("email", "operator@villiz.com");

    const result = await requestSignInLink({ status: "idle", message: "" }, form);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/could not send a sign-in link/i);
    expect(result.message).not.toMatch(/rate limit|provider|operator@villiz\.com/i);
  });

  it("does not call Supabase for an email outside the staff domain", async () => {
    const { requestSignInLink } = await import("@/server/actions/auth");
    const form = new FormData();
    form.set("email", "client@example.com");

    const result = await requestSignInLink({ status: "idle", message: "" }, form);

    expect(result.status).toBe("error");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
