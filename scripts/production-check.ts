/**
 * Sprint 8.0 — Production Hosting.
 *
 *   npm run production:check
 *
 * Validates the environment this process is currently running with against
 * the contract .env.production.example documents. Deliberately does not
 * make any network call (Supabase/Blotato reachability is already
 * `npm run cloud:check`'s job) — this is purely "are the right variables
 * set, to safe-looking values, with no secret leaking into a NEXT_PUBLIC_
 * variable." Run it locally with a real .env.production-shaped file loaded,
 * or in CI/at deploy time against whatever the platform has already
 * injected into process.env.
 *
 * Exit code 0: no errors (warnings are still printed, but never block).
 * Exit code 1: at least one error.
 */
import { validateProductionEnv } from "./production/validate-env";

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const blue = (text: string) => `\x1b[34m${text}\x1b[0m`;

function main() {
  console.log(blue("=== Production Environment Validation ==="));

  const { errors, warnings } = validateProductionEnv(process.env);

  if (errors.length === 0 && warnings.length === 0) {
    console.log(green("✔ All required production environment variables are present and safe."));
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log("");
    console.log(red(`${errors.length} error(s):`));
    for (const error of errors) console.log(red(`  ✘ ${error}`));
  }

  if (warnings.length > 0) {
    console.log("");
    console.log(yellow(`${warnings.length} warning(s):`));
    for (const warning of warnings) console.log(yellow(`  ⚠ ${warning}`));
  }

  console.log("");
  if (errors.length > 0) {
    console.log(red("=== Production environment validation FAILED ==="));
    process.exit(1);
  }

  console.log(green("✔ No errors — warnings above are expected/deliberate for this deployment stage, see .env.production.example."));
  process.exit(0);
}

main();
