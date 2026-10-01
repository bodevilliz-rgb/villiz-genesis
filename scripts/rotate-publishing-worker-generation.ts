import "server-only";
import * as crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/infrastructure/supabase/database.types";

const LIVE_SWITCH = "BLOTATO_LIVE_PUBLISHING_ENABLED";
const GENERATION_ID = "PUBLISHING_WORKER_GENERATION_ID";
const CAPABILITY_PROOF = "PUBLISHING_LIVE_CAPABILITY_PROOF";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function renderEnvUrl(serviceId: string, key: string): string {
  return `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`;
}

async function readRenderEnv(apiKey: string, serviceId: string, key: string): Promise<string> {
  const response = await fetch(renderEnvUrl(serviceId, key), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Render could not read ${key} (HTTP ${response.status}).`);
  }
  const payload = await response.json() as { value?: unknown; envVar?: { value?: unknown } };
  const value = payload.value ?? payload.envVar?.value;
  if (typeof value !== "string") throw new Error(`Render returned no string value for ${key}.`);
  return value;
}

async function writeRenderEnv(
  apiKey: string,
  serviceId: string,
  key: string,
  value: string,
): Promise<void> {
  const response = await fetch(renderEnvUrl(serviceId, key), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) {
    // Never include Render's response body: a provider error may echo the
    // submitted secret value.
    throw new Error(`Render could not update ${key} (HTTP ${response.status}).`);
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    console.info("Dry run only. Re-run with --apply to rotate one publishing generation.");
    console.info("The command keeps live publishing disabled and never prints the capability proof.");
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim() || requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const renderApiKey = requireEnv("RENDER_API_KEY");
  const renderServiceId = requireEnv("PUBLISHING_RENDER_SERVICE_ID");
  const expectedGenerationId = requireEnv("PUBLISHING_ROTATION_EXPECTED_GENERATION_ID");

  const proof = crypto.randomBytes(32).toString("hex");
  const proofHash = crypto.createHash("sha256").update(proof).digest("hex");
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "z").toLowerCase();
  const newGenerationId = `gen-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const previous = {
    generationId: await readRenderEnv(renderApiKey, renderServiceId, GENERATION_ID),
    proof: await readRenderEnv(renderApiKey, renderServiceId, CAPABILITY_PROOF),
  };
  if (previous.generationId !== expectedGenerationId) {
    throw new Error("Render generation changed since authorisation; rotation aborted.");
  }

  let rotated = false;
  try {
    // Kill live eligibility before either side of the cross-system update.
    await writeRenderEnv(renderApiKey, renderServiceId, LIVE_SWITCH, "false");

    const rotation = await supabase.rpc("rotate_publishing_worker_generation", {
      p_expected_generation_id: expectedGenerationId,
      p_new_generation_id: newGenerationId,
      p_capability_proof_sha256: proofHash,
      p_valid_until: validUntil,
    });
    if (rotation.error) throw new Error(`Database generation rotation failed (${rotation.error.code ?? "unknown"}).`);
    rotated = true;

    await writeRenderEnv(renderApiKey, renderServiceId, GENERATION_ID, newGenerationId);
    await writeRenderEnv(renderApiKey, renderServiceId, CAPABILITY_PROOF, proof);
    await writeRenderEnv(renderApiKey, renderServiceId, LIVE_SWITCH, "false");

    console.info(`Generation rotation completed for service ${renderServiceId}.`);
    console.info(`Generation ID: ${newGenerationId}`);
    console.info(`Valid until: ${validUntil}`);
    console.info("Live publishing remains disabled. The capability proof was not printed.");
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (rotated) {
      const rollback = await supabase.rpc("rollback_publishing_worker_generation", {
        p_failed_generation_id: newGenerationId,
        p_previous_generation_id: expectedGenerationId,
      });
      if (rollback.error) rollbackErrors.push(`database rollback (${rollback.error.code ?? "unknown"})`);
    }

    for (const [key, value] of [
      [GENERATION_ID, previous.generationId],
      [CAPABILITY_PROOF, previous.proof],
      [LIVE_SWITCH, "false"],
    ] as const) {
      try {
        await writeRenderEnv(renderApiKey, renderServiceId, key, value);
      } catch {
        rollbackErrors.push(`Render rollback for ${key}`);
      }
    }

    const reason = error instanceof Error ? error.message : "Unknown generation rotation failure.";
    const rollbackSuffix = rollbackErrors.length > 0
      ? ` Rollback also failed: ${rollbackErrors.join(", ")}.`
      : " Rollback completed; live publishing is disabled.";
    throw new Error(`${reason}${rollbackSuffix}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Publishing generation rotation failed.");
  process.exitCode = 1;
});
