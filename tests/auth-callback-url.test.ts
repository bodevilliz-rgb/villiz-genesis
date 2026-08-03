import { describe, expect, it } from "vitest";
import { resolveSafeNextPath, routes } from "@/lib/routes";

describe("resolveSafeNextPath (auth callback URL construction)", () => {
  it("honours a same-origin relative path", () => {
    expect(resolveSafeNextPath("/organisations/123/content")).toBe("/organisations/123/content");
  });

  it("falls back to the dashboard when next is missing", () => {
    expect(resolveSafeNextPath(null)).toBe(routes.dashboard);
  });

  it("falls back to the dashboard when next is an empty string", () => {
    expect(resolveSafeNextPath("")).toBe(routes.dashboard);
  });

  it("rejects a protocol-relative URL (open-redirect attempt)", () => {
    expect(resolveSafeNextPath("//evil.example.com/phish")).toBe(routes.dashboard);
  });

  it("rejects a fully-qualified external URL", () => {
    expect(resolveSafeNextPath("https://evil.example.com/phish")).toBe(routes.dashboard);
  });

  it("rejects a path that does not start with a slash", () => {
    expect(resolveSafeNextPath("dashboard")).toBe(routes.dashboard);
  });
});
