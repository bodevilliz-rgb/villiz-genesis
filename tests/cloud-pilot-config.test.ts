import { describe, expect, it } from "vitest";
import { isCloudSupabaseUrl, isCloudEnvironment, isCloudPilotSelfApprovalEnabled } from "@/lib/cloud-pilot-config";

describe("isCloudSupabaseUrl (production URL helper, reused by npm run production:check)", () => {
  it("accepts a real https cloud Supabase URL", () => {
    expect(isCloudSupabaseUrl("https://pxygyzgzkqjludwxtgbz.supabase.co")).toBe(true);
  });

  it.each(["http://localhost:54321", "http://127.0.0.1:54321", "http://0.0.0.0:54321", "http://[::1]:54321", "https://myhost.local"])(
    "rejects the local hostname %s",
    (localUrl) => {
      expect(isCloudSupabaseUrl(localUrl)).toBe(false);
    },
  );

  it("rejects a non-https URL even if the host is otherwise a real domain", () => {
    expect(isCloudSupabaseUrl("http://pxygyzgzkqjludwxtgbz.supabase.co")).toBe(false);
  });

  it("rejects undefined and unparseable input without throwing", () => {
    expect(isCloudSupabaseUrl(undefined)).toBe(false);
    expect(isCloudSupabaseUrl("not a url")).toBe(false);
  });
});

describe("isCloudEnvironment", () => {
  it("reflects NEXT_PUBLIC_SUPABASE_URL via the same predicate", () => {
    const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://pxygyzgzkqjludwxtgbz.supabase.co";
      expect(isCloudEnvironment()).toBe(true);

      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      expect(isCloudEnvironment()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
    }
  });
});

describe("isCloudPilotSelfApprovalEnabled", () => {
  it("is true only when the flag is the exact string \"true\"", () => {
    const original = process.env.CLOUD_PILOT_SELF_APPROVAL;
    try {
      process.env.CLOUD_PILOT_SELF_APPROVAL = "true";
      expect(isCloudPilotSelfApprovalEnabled()).toBe(true);

      for (const other of ["false", "1", "TRUE", "", undefined]) {
        if (other === undefined) delete process.env.CLOUD_PILOT_SELF_APPROVAL;
        else process.env.CLOUD_PILOT_SELF_APPROVAL = other;
        expect(isCloudPilotSelfApprovalEnabled()).toBe(false);
      }
    } finally {
      if (original === undefined) delete process.env.CLOUD_PILOT_SELF_APPROVAL;
      else process.env.CLOUD_PILOT_SELF_APPROVAL = original;
    }
  });
});
