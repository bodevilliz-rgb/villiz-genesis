import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CERTIFIED_PUBLISHING_MIGRATIONS = {
  "supabase/migrations/20260907000000_publishing_safe_recovery_settlement.sql":
    "e8a73c26c2d52cc3edc304e956b09859743ae7973fd2a6048246298a292f08f2",
  "supabase/migrations/20260907001000_media_library_stats.sql":
    "c59943a2b34050435142e527ad8073c43764186c11e2cb1c42477a9cf501d56c",
  "supabase/migrations/20260907010000_legacy_timeout_reconciliation.sql":
    "9b9aed7e5c6b31914383dd5d24c28b9ec0c96152a4e34202839238c6e13e0149",
  "supabase/migrations/20260909000000_publishing_claim_isolation.sql":
    "967b4860cbf384fb64a8f7f5227277738bc6e93094869d6af6234992e394f364",
} as const;

describe("certified publishing migration history", () => {
  for (const [path, expectedHash] of Object.entries(CERTIFIED_PUBLISHING_MIGRATIONS)) {
    it(`preserves ${path}`, () => {
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
      expect(hash).toBe(expectedHash);
    });
  }
});
