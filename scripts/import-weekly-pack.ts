/**
 * Imports an approved social-pipeline weekly pack into the Genesis Picks Queue.
 * This is the only boundary that reads scan_state.json; the application runtime
 * reads only picks_queue_items under organisation RLS.
 *
 * Usage:
 *   npx tsx scripts/import-weekly-pack.ts --org "Mervic" \
 *     --scan /home/villiz/Atlas/social-pipeline/scan_state.json \
 *     --metadata /home/villiz/Atlas/social-pipeline/inbox/pack_metadata.json
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

for (const candidate of [".env.local", ".env"]) {
  const fullPath = path.resolve(process.cwd(), candidate);
  if (existsSync(fullPath)) process.loadEnvFile(fullPath);
}

import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { parseWeeklyPackSources, selectInitialWeeklyPackItems } from "./weekly-pack-import-core";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const organisationNameOrId = argValue("--org");
  const scanPath = argValue("--scan");
  const metadataPath = argValue("--metadata");
  if (!organisationNameOrId || !scanPath || !metadataPath) {
    throw new Error("--org, --scan and --metadata are required");
  }

  const [scanRaw, metadataRaw] = await Promise.all([
    readFile(path.resolve(scanPath), "utf8"),
    readFile(path.resolve(metadataPath), "utf8"),
  ]);
  const parsedItems = parseWeeklyPackSources(JSON.parse(scanRaw), JSON.parse(metadataRaw));
  const items = selectInitialWeeklyPackItems(parsedItems);
  const admin = createAdminClient();
  const organisations = await admin.from("organisations").select("id, name");
  if (organisations.error) throw new Error(`Organisation lookup failed: ${organisations.error.message}`);
  const organisation = (organisations.data ?? []).find((item) => item.id === organisationNameOrId || item.name === organisationNameOrId);
  if (!organisation) throw new Error(`UNKNOWN_ORGANISATION: ${organisationNameOrId}`);

  const organisationBrand = organisation.name.toLowerCase().startsWith("villiz") ? "villiz" : organisation.name.toLowerCase();
  const brandItems = items.filter((item) => item.brand.toLowerCase() === organisationBrand);
  if (brandItems.length === 0) throw new Error(`No weekly-pack items matched organisation ${organisation.name}.`);

  const rows = brandItems.map((item) => ({
    organisation_id: organisation.id,
    source_key: item.sourceKey,
    source_kind: "drive_reference" as const,
    source_ref: `drive:${item.driveFileId}`,
    item_label: item.itemLabel,
    caption_options: item.captionOptions,
    slot_time: item.slotTime,
    status: "staged" as const,
    metadata: { ...item.metadata, fileName: item.fileName, importedBy: "scripts/import-weekly-pack.ts" },
  }));
  const result = await admin.from("picks_queue_items").upsert(rows, { onConflict: "organisation_id,source_key" }).select("id");
  if (result.error) throw new Error(`Picks import failed: ${result.error.message}`);
  process.stdout.write(`${JSON.stringify({ organisation: organisation.name, parsed: parsedItems.length, selected: items.length, matched: brandItems.length, imported: result.data?.length ?? 0 })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
