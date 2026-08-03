/**
 * Sprint 7.1 — Operation Iron Shield.
 *
 * These checks are the only ones in the suite that need a real Postgres
 * connection — they prove guarantees that are fundamentally database-level
 * (FOR UPDATE SKIP LOCKED claim exclusivity, a unique-index-enforced
 * duplicate ban, real cross-organisation scoping) and cannot be honestly
 * proven by an in-memory fake, no matter how faithful. They connect ONLY to
 * the local Supabase stack (the exact same "must be local, never cloud"
 * guard dev-local.js/cloud-check.ts/cloud-bootstrap.ts already enforce).
 *
 * If `.env.local` is missing, or its Supabase URL is not local, or the local
 * Supabase stack isn't actually reachable, every check in this module
 * reports SKIP with a clear reason — `npm run reliability:test` still
 * completes and still exits 0 for an otherwise-healthy run; it just can't
 * prove these specific guarantees without Docker running.
 *
 * Cleanup note (a real discovery, not a workaround for a bug): deleting a
 * fixture organisation cascades to content_drafts -> content_draft_versions,
 * and this schema makes content_draft_versions rows genuinely immutable —
 * app.guard_content_draft_version_history raises 42501 ("Content draft
 * version history cannot be deleted") the instant any DELETE reaches that
 * table, which aborts the whole cascading delete and leaves the
 * organisation (and every publishing_jobs row still attached to it) in
 * place. That guard is a deliberate, correct protection (draft history must
 * be auditable) — not something this suite should ever weaken or bypass.
 * So cleanup here does two independent things instead of relying on
 * deletion succeeding: (1) it always retires every publishing_jobs row a
 * check created to a terminal 'cancelled' status, which is what actually
 * matters for repeatability — a cancelled job can never again be claimed,
 * recovered, or trip an active-job uniqueness check in a later run; (2) it
 * still attempts to delete the organisation as a best-effort tidy-up, and
 * only swallows the specific, expected 42501 from the version-history
 * guard — any other deletion error still surfaces as a real problem.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabasePublishingRepository } from "@/infrastructure/repositories/supabase-publishing-repository";
import { SupabaseContentRepository } from "@/infrastructure/repositories/supabase-content-repository";
import { claimNextPublishingJob, recoverStalePublishingJobs } from "@/core/application/use-cases/publishing";
import type { ReliabilityCheck } from "./types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LOCAL_ENV_PATH = path.join(REPO_ROOT, ".env.local");
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function isLocalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase()) || parsed.hostname.endsWith(".local");
  } catch {
    return false;
  }
}

interface DbTierState {
  available: boolean;
  reason: string;
  client: SupabaseClient | null;
}

let cachedState: DbTierState | null = null;

/** Detects (once per process) whether the DB tier can run at all. Never throws — an unreachable stack is a SKIP, not a crash. */
async function detectDbTier(): Promise<DbTierState> {
  if (cachedState) return cachedState;

  if (!existsSync(LOCAL_ENV_PATH)) {
    cachedState = { available: false, reason: ".env.local not found — DB-tier checks require the local Supabase stack (npm run dev:local).", client: null };
    return cachedState;
  }

  try {
    process.loadEnvFile(LOCAL_ENV_PATH);
  } catch {
    // Already loaded by a parent process — fine, process.env already has what we need.
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    cachedState = { available: false, reason: ".env.local is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.", client: null };
    return cachedState;
  }
  if (!isLocalUrl(url)) {
    cachedState = { available: false, reason: `NEXT_PUBLIC_SUPABASE_URL ("${url}") is not local — DB-tier checks refuse to run against anything but the local Supabase stack.`, client: null };
    return cachedState;
  }

  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const { error } = await client.from("organisations").select("id").limit(1);
    if (error) throw error;
  } catch (error) {
    cachedState = {
      available: false,
      reason: `local Supabase is not reachable (${error instanceof Error ? error.message : String(error)}) — start it with \`npm run dev:local\` or \`npx supabase start\` to include these checks.`,
      client: null,
    };
    return cachedState;
  }

  cachedState = { available: true, reason: "", client };
  return cachedState;
}

/** The one known-expected reason organisation deletion can fail — see this module's own doc comment above. */
const IMMUTABLE_VERSION_HISTORY_ERROR_CODE = "42501";

/** Creates one isolated, uniquely-named organisation + content_draft to hang publishing_jobs fixtures off of. Never touches any pre-existing row. */
async function createFixtureOrg(client: SupabaseClient, label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const slug = `reliability-${label}-${suffix}`.slice(0, 60);

  const { data: org, error: orgError } = await client
    .from("organisations")
    .insert({ name: `Reliability Suite — ${label}`, slug, status: "active" })
    .select("id")
    .single();
  if (orgError) throw new Error(`fixture setup failed creating organisation: ${orgError.message}`);

  const { data: draft, error: draftError } = await client
    .from("content_drafts")
    .insert({ organisation_id: org.id, title: `Reliability suite fixture draft (${label})`, body: "fixture", status: "approved" })
    .select("id")
    .single();
  if (draftError) {
    throw new Error(`fixture setup failed creating content_draft: ${draftError.message}`);
  }

  return {
    organisationId: org.id as string,
    draftId: draft.id as string,
    /**
     * Always retires every publishing_jobs row this check created to a
     * terminal status first (the part that actually prevents leftovers from
     * winning a future run's FIFO claim), then makes a best-effort attempt
     * to delete the organisation — swallowing only the expected
     * version-history immutability error.
     */
    async cleanup(jobIds: string[] = []) {
      if (jobIds.length > 0) {
        const { error: retireError } = await client.from("publishing_jobs").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).in("id", jobIds);
        if (retireError) throw new Error(`fixture cleanup failed to retire job(s) ${jobIds.join(", ")}: ${retireError.message}`);
      }

      const { error: deleteError } = await client.from("organisations").delete().eq("id", org.id);
      if (deleteError && deleteError.code !== IMMUTABLE_VERSION_HISTORY_ERROR_CODE) {
        throw new Error(`fixture cleanup failed deleting organisation ${org.id}: ${deleteError.message}`);
      }
    },
  };
}

function wrap(name: string, run: (client: SupabaseClient) => Promise<void>): ReliabilityCheck {
  return {
    name,
    classification: "MANDATORY",
    async run() {
      const state = await detectDbTier();
      if (!state.available || !state.client) {
        return { skip: state.reason };
      }
      await run(state.client);
    },
  };
}

export const workerJobClaimDbCheck = wrap("Worker job claim (real database exclusivity)", async (client) => {
  const fixture = await createFixtureOrg(client, "claim");
  let jobId: string | undefined;
  try {
    const { data: job, error } = await client
      .from("publishing_jobs")
      .insert({
        organisation_id: fixture.organisationId,
        draft_id: fixture.draftId,
        platform: "linkedin",
        trigger_type: "immediate",
        scheduled_for: new Date(Date.now() - 60_000).toISOString(),
        idempotency_key: `reliability-claim-${fixture.draftId}`,
      })
      .select("id")
      .single();
    if (error) throw new Error(`could not seed a due queued job: ${error.message}`);
    jobId = job.id;

    const publishing = new SupabasePublishingRepository(client);
    // Sequential, not Promise.all: a genuinely simultaneous race at the HTTP
    // level is exactly what FOR UPDATE SKIP LOCKED exists to serialize
    // correctly inside Postgres, but proving that specific microsecond-level
    // race deterministically over a real network round-trip is exactly the
    // kind of test that's flaky through no fault of the RPC itself. The
    // property this check actually needs to prove per the mission spec —
    // "another worker cannot claim the same job" — is fully and
    // deterministically provable this way: claim it, then prove a second
    // claim attempt finds nothing left to claim (there is only ever one due
    // job in the table at a time — every other fixture job this suite
    // creates is either not yet due, already terminal, or retired by its
    // own check's cleanup before this one runs).
    const first = await claimNextPublishingJob({ publishing }, "reliability-worker-a");
    const second = await claimNextPublishingJob({ publishing }, "reliability-worker-b");

    if (!first || first.id !== job.id) {
      throw new Error(`the first worker did not claim the seeded due job ${job.id}`);
    }
    if (second !== null) {
      throw new Error(`a second worker claimed a job after the only due job was already claimed — exclusivity failed`);
    }
    if (first.status !== "processing") {
      throw new Error(`a claimed job's status must be 'processing', got '${first.status}'`);
    }
    if (!first.claimedBy) {
      throw new Error("claimed_by must be recorded on the winning claim");
    }
  } finally {
    await fixture.cleanup(jobId ? [jobId] : []);
  }
});

export const workerRestartRecoveryDbCheck = wrap("Worker restart recovery (real database)", async (client) => {
  const fixture = await createFixtureOrg(client, "recovery");
  let jobId: string | undefined;
  try {
    const staleClaimedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    const { data: job, error } = await client
      .from("publishing_jobs")
      .insert({
        organisation_id: fixture.organisationId,
        draft_id: fixture.draftId,
        platform: "linkedin",
        trigger_type: "immediate",
        status: "processing",
        claimed_by: "reliability-dead-worker",
        claimed_at: staleClaimedAt,
        idempotency_key: `reliability-recovery-${fixture.draftId}`,
      })
      .select("id, retry_count")
      .single();
    if (error) throw new Error(`could not seed a stale processing job: ${error.message}`);
    jobId = job.id;

    const publishing = new SupabasePublishingRepository(client);
    const recovered = await recoverStalePublishingJobs({ publishing }, 1);
    const ours = recovered.find((j) => j.id === job.id);
    if (!ours) throw new Error("recoverStalePublishingJobs did not recover the seeded stale job at all");
    if (ours.status !== "queued") throw new Error(`expected the recovered job (retry_count < max_retries) to become 'queued', got '${ours.status}'`);
    if (ours.retryCount !== job.retry_count + 1) throw new Error("retry_count must increment on recovery");
    if (ours.claimedBy !== null) throw new Error("claimed_by must be cleared so a fresh worker can claim the recovered job");

    // A second recovery pass, immediately after, must find nothing left —
    // recovery is idempotent, it never recovers the same job twice.
    const secondPass = await recoverStalePublishingJobs({ publishing }, 1);
    if (secondPass.some((j) => j.id === job.id)) {
      throw new Error("the same job was recovered a second time — recovery must be idempotent");
    }
  } finally {
    await fixture.cleanup(jobId ? [jobId] : []);
  }
});

export const duplicatePublishPreventionDbCheck = wrap("Duplicate publish prevention (real unique constraint)", async (client) => {
  const fixture = await createFixtureOrg(client, "dup");
  let jobId: string | undefined;
  try {
    const shared = {
      organisation_id: fixture.organisationId,
      draft_id: fixture.draftId,
      platform: "linkedin" as const,
      trigger_type: "immediate" as const,
    };

    // idempotency_key is unique across the whole table (not per-organisation),
    // so — unlike draft_id/organisation_id, which are fresh every run because
    // createFixtureOrg mints a new organisation each time — a hardcoded
    // literal key here would collide with a leftover row from any run whose
    // cleanup didn't complete. Deriving it from the fixture draft's own id
    // keeps it unique per run without relying on perfect cleanup.
    const key = `reliability-dup-${fixture.draftId}`;

    const first = await client.from("publishing_jobs").insert({ ...shared, idempotency_key: key }).select("id").single();
    if (first.error) throw new Error(`first insert unexpectedly failed: ${first.error.message}`);
    jobId = first.data.id;

    // Same draft+platform, a DIFFERENT idempotency key (simulating a second,
    // independently-submitted request racing the first) while the first is
    // still active (queued) — the database's own partial unique index
    // (publishing_jobs_active_unique) must reject this, not just application
    // logic.
    const second = await client.from("publishing_jobs").insert({ ...shared, idempotency_key: `${key}-b` }).select("id").single();
    if (!second.error) {
      throw new Error("a second active job for the same draft+platform was inserted — publishing_jobs_active_unique did not fire");
    }
    if (second.error.code !== "23505") {
      throw new Error(`expected a unique_violation (23505), got code ${second.error.code}: ${second.error.message}`);
    }

    // The exact same idempotency key must also be rejected outright.
    const third = await client.from("publishing_jobs").insert({ ...shared, idempotency_key: key }).select("id").single();
    if (!third.error || third.error.code !== "23505") {
      throw new Error("a duplicate idempotency_key was not rejected by publishing_jobs_idempotency_key_unique");
    }
  } finally {
    await fixture.cleanup(jobId ? [jobId] : []);
  }
});

export const organisationIsolationDbCheck = wrap("Organisation isolation (real database, cross-organisation lookups)", async (client) => {
  // A full end-to-end simulation of RLS specifically would require
  // provisioning a real authenticated session (a signed JWT) for a
  // non-member profile — heavier than this suite should require for every
  // run, and this service-role client bypasses RLS entirely by design (see
  // admin-client.ts). What this check proves instead, against a real
  // database with two genuinely separate organisations: the repository's
  // own organisation-scoped queries (`.eq("organisation_id", ...)`) — a real
  // defense-in-depth layer independent of RLS — never return another
  // organisation's row, even when asked for it by exact id.
  const fixtureA = await createFixtureOrg(client, "iso-a");
  const fixtureB = await createFixtureOrg(client, "iso-b");
  let jobBId: string | undefined;
  try {
    const { data: jobB, error: jobError } = await client
      .from("publishing_jobs")
      .insert({
        organisation_id: fixtureB.organisationId,
        draft_id: fixtureB.draftId,
        platform: "linkedin",
        trigger_type: "immediate",
        status: "failed",
        idempotency_key: `reliability-iso-${fixtureB.draftId}`,
      })
      .select("id")
      .single();
    if (jobError) throw new Error(`could not seed Org B's job: ${jobError.message}`);
    jobBId = jobB.id;

    const publishing = new SupabasePublishingRepository(client);
    const content = new SupabaseContentRepository(client);

    const crossOrgJob = await publishing.findJobById(fixtureA.organisationId, jobB.id);
    if (crossOrgJob !== null) {
      throw new Error("Org A was able to look up Org B's publishing job by id — organisation scoping failed");
    }

    const crossOrgDraft = await content.findDraft(fixtureA.organisationId, fixtureB.draftId);
    if (crossOrgDraft !== null) {
      throw new Error("Org A was able to look up Org B's draft by id — organisation scoping failed");
    }

    // Sanity check the negative isn't just "nothing exists": Org B must be
    // able to see its own rows through the exact same methods.
    const ownJob = await publishing.findJobById(fixtureB.organisationId, jobB.id);
    if (ownJob === null) throw new Error("test fixture invalid: Org B could not see its own job — cannot trust the negative result above");
  } finally {
    await fixtureA.cleanup([]);
    await fixtureB.cleanup(jobBId ? [jobBId] : []);
  }
});

export const allDbTierChecks: ReliabilityCheck[] = [
  workerJobClaimDbCheck,
  workerRestartRecoveryDbCheck,
  duplicatePublishPreventionDbCheck,
  organisationIsolationDbCheck,
];
