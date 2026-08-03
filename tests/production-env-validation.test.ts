import { describe, expect, it } from "vitest";
import { validateProductionEnv } from "../scripts/production/validate-env";

const VALID_ENV = {
  NEXT_PUBLIC_SITE_URL: "https://villiz-genesis.vercel.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
  ALLOWED_EMAIL_DOMAINS: "villiz.com",
  ENABLE_DEV_LOGIN: "false",
  BLOTATO_API_KEY: "real-blotato-key",
  BLOTATO_ENABLED: "true",
  BLOTATO_LIVE_PUBLISHING_ENABLED: "false",
};

describe("validateProductionEnv", () => {
  it("passes a fully valid production environment with no errors or warnings", () => {
    const result = validateProductionEnv(VALID_ENV);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("fails clearly when required variables are entirely missing", () => {
    const result = validateProductionEnv({});
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SITE_URL"))).toBe(true);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("ALLOWED_EMAIL_DOMAINS"))).toBe(true);
  });

  it("rejects a localhost NEXT_PUBLIC_SITE_URL as unsafe", () => {
    const result = validateProductionEnv({ ...VALID_ENV, NEXT_PUBLIC_SITE_URL: "http://localhost:3001" });
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SITE_URL"))).toBe(true);
  });

  it("rejects a local Supabase URL as unsafe", () => {
    for (const localUrl of ["http://127.0.0.1:54321", "http://localhost:54321", "https://myhost.local"]) {
      const result = validateProductionEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: localUrl });
      expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
    }
  });

  it("accepts a real https cloud Supabase URL", () => {
    const result = validateProductionEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://pxygyzgzkqjludwxtgbz.supabase.co" });
    expect(result.errors).toEqual([]);
  });

  it("flags a secret value leaking into a NEXT_PUBLIC_ variable", () => {
    const result = validateProductionEnv({
      ...VALID_ENV,
      NEXT_PUBLIC_OOPS: VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
    });
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_OOPS"))).toBe(true);
  });

  it("does not flag NEXT_PUBLIC_SUPABASE_ANON_KEY itself as a leak (it is legitimately public)", () => {
    const result = validateProductionEnv(VALID_ENV);
    expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"))).toBe(false);
  });

  it("fails when ENABLE_DEV_LOGIN is true", () => {
    const result = validateProductionEnv({ ...VALID_ENV, ENABLE_DEV_LOGIN: "true" });
    expect(result.errors.some((e) => e.includes("ENABLE_DEV_LOGIN"))).toBe(true);
  });

  it("warns (does not fail) when CLOUD_PILOT_SELF_APPROVAL is true", () => {
    const result = validateProductionEnv({ ...VALID_ENV, CLOUD_PILOT_SELF_APPROVAL: "true" });
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("CLOUD_PILOT_SELF_APPROVAL"))).toBe(true);
  });

  it("fails when BLOTATO_ENABLED is true but BLOTATO_API_KEY is missing", () => {
    const result = validateProductionEnv({ ...VALID_ENV, BLOTATO_API_KEY: undefined });
    expect(result.errors.some((e) => e.includes("BLOTATO_API_KEY"))).toBe(true);
  });

  it("fails when BLOTATO_LIVE_PUBLISHING_ENABLED is set to an invalid value", () => {
    const result = validateProductionEnv({ ...VALID_ENV, BLOTATO_LIVE_PUBLISHING_ENABLED: "yes" });
    expect(result.errors.some((e) => e.includes("BLOTATO_LIVE_PUBLISHING_ENABLED"))).toBe(true);
  });

  it("warns (does not fail) when BLOTATO_LIVE_PUBLISHING_ENABLED is true", () => {
    const result = validateProductionEnv({ ...VALID_ENV, BLOTATO_LIVE_PUBLISHING_ENABLED: "true" });
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("BLOTATO_LIVE_PUBLISHING_ENABLED"))).toBe(true);
  });
});
