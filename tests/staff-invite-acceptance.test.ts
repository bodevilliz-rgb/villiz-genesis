import { describe, expect, it } from "vitest";
import { parseInviteSessionHash } from "@/lib/invite-session";
import { readFileSync } from "node:fs";

describe("Supabase Admin staff invitation acceptance", () => {
  it("accepts the implicit invite session contract", () => {
    expect(parseInviteSessionHash("#access_token=access&refresh_token=refresh&type=invite")).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it("accepts the existing-user resend magic-link contract", () => {
    expect(parseInviteSessionHash("#type=magiclink&refresh_token=refresh&access_token=access")).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it("fails closed for incomplete, unrelated or query-string input", () => {
    expect(parseInviteSessionHash("#type=invite&access_token=access")).toBeNull();
    expect(parseInviteSessionHash("#type=recovery&access_token=access&refresh_token=refresh")).toBeNull();
    expect(parseInviteSessionHash("?code=pkce-code")).toBeNull();
  });

  it("keeps the ordinary PKCE callback and redirects only missing-code requests to client acceptance", () => {
    const source = readFileSync("src/app/auth/callback/route.ts", "utf8");
    expect(source).toContain("exchangeCodeForSession(code)");
    expect(source).toContain('NextResponse.redirect(`${origin}/auth/accept`)');
  });

  it("sends staff links directly to the client acceptance route so the session fragment is never carried across a server redirect", () => {
    const source = readFileSync("src/server/staff-admin.ts", "utf8");
    expect(source).toContain("routes.authAccept");
    expect(source).not.toMatch(/emailRedirectTo:[^\n]*routes\.authCallback/);
  });
});
