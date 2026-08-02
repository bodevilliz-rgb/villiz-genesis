/**
 * npm run cloud:bootstrap -- --email you@villiz.com --confirm
 *
 * Creates ONLY the two things a brand-new cloud project has zero of and
 * genuinely cannot function without: one "Villiz Pixels" organisation, and
 * one staff profile (with an auth user, if one doesn't already exist) tied
 * to the email you pass. It never touches content_drafts, campaigns,
 * media_assets, publishing_jobs, or anything else supabase/seed.sql seeds
 * locally — local seed data is never copied into the cloud project.
 *
 * Idempotent: re-running it after the org/profile already exist reports
 * "already exists" and changes nothing.
 *
 * Requires explicit confirmation: without --confirm, this prints exactly
 * what it WOULD do and exits without writing anything. --email is always
 * required — there is no default operator email.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { slugify } from "../src/lib/slug";

const REPO_ROOT = path.resolve(__dirname, "..");
const CLOUD_ENV_PATH = path.join(REPO_ROOT, ".env.cloud.local");
const ORGANISATION_NAME = "Villiz Pixels";
/**
 * organisations.slug is NOT NULL + UNIQUE + CHECK (^[a-z0-9]+(-[a-z0-9]+)*$)
 * — this script previously inserted { name, status } only, which is exactly
 * why bootstrap failed with "null value in column \"slug\"". The value below
 * is asserted (see main()) to match slugify(ORGANISATION_NAME), reusing the
 * same helper src/core/application/use-cases/organisations/index.ts's own
 * resolveSlug() is built on — see src/lib/slug.ts.
 */
const ORGANISATION_SLUG = "villiz-pixels";

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const blue = (text: string) => `\x1b[34m${text}\x1b[0m`;

function fail(message: string): never {
  console.error(red(`✘ ${message}`));
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const emailIndex = argv.indexOf("--email");
  const email = emailIndex >= 0 ? argv[emailIndex + 1] : undefined;
  const confirm = argv.includes("--confirm");
  return { email, confirm };
}

export interface OrganisationRecord {
  id: string;
}

export interface EnsureOrganisationDeps {
  /** SELECT id FROM organisations WHERE slug = $1 LIMIT 1 — read-only, must never throw for "not found" (return null instead). */
  findOrganisationBySlug: (slug: string) => Promise<OrganisationRecord | null>;
  /** INSERT INTO organisations (name, slug, ...) — only ever called once, only when confirm is true and no row was found by slug. */
  createOrganisation: (input: { name: string; slug: string }) => Promise<OrganisationRecord>;
}

export interface EnsureOrganisationInput {
  name: string;
  slug: string;
  confirm: boolean;
}

export type EnsureOrganisationOutcome = "found" | "created" | "would_create";

export interface EnsureOrganisationResult {
  organisationId: string | null;
  outcome: EnsureOrganisationOutcome;
  message: string;
}

/**
 * The one place that decides whether the Villiz Pixels organisation needs
 * creating — idempotent by slug (organisations.slug is the unique
 * constraint, not name), and safe to call again on a project left in any
 * state a previous partial run could produce: whether this call finds an
 * existing row or creates a fresh one, the caller (main(), below) always
 * continues on to verify the staff profile and organisation membership
 * afterwards, so a slug that exists with no linked profile/membership yet
 * still finishes bootstrapping correctly rather than being treated as
 * "already done".
 *
 * Pure aside from the two injected I/O functions — takes no Supabase client
 * directly, so it's fully testable with in-memory fakes (see
 * tests/cloud-bootstrap.test.ts).
 */
export async function ensureOrganisation(
  deps: EnsureOrganisationDeps,
  input: EnsureOrganisationInput,
): Promise<EnsureOrganisationResult> {
  const existing = await deps.findOrganisationBySlug(input.slug);
  if (existing) {
    return {
      organisationId: existing.id,
      outcome: "found",
      message: `Organisation found by slug "${input.slug}" (id: ${existing.id}) — reusing existing organisation. Any missing profile or membership will still be checked and created below.`,
    };
  }

  if (!input.confirm) {
    return {
      organisationId: null,
      outcome: "would_create",
      message: `Organisation not found by slug "${input.slug}" — would create "${input.name}".`,
    };
  }

  let created: OrganisationRecord;
  try {
    created = await deps.createOrganisation({ name: input.name, slug: input.slug });
  } catch (error) {
    // Surface exactly which organisation this was for — a bare Postgres
    // error message alone (e.g. a constraint violation) gives no context
    // once it's bubbled up through main()'s generic fail() handler.
    throw new Error(
      `Failed to create organisation "${input.name}" (slug: "${input.slug}"): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    organisationId: created.id,
    outcome: "created",
    message: `Organisation created: "${input.name}" (slug: "${input.slug}", id: ${created.id}).`,
  };
}

async function main() {
  console.log(blue("=== Cloud Bootstrap (organisation + staff profile) ==="));

  const { email, confirm } = parseArgs(process.argv.slice(2));
  if (!email) {
    fail("Usage: npm run cloud:bootstrap -- --email you@villiz.com --confirm");
  }

  if (slugify(ORGANISATION_NAME) !== ORGANISATION_SLUG) {
    fail(`Internal error: ORGANISATION_SLUG ("${ORGANISATION_SLUG}") does not match slugify(ORGANISATION_NAME) ("${slugify(ORGANISATION_NAME)}").`);
  }

  if (!existsSync(CLOUD_ENV_PATH)) {
    fail(".env.cloud.local is missing. This script never falls back to .env.local — create it first.");
  }
  process.loadEnvFile(CLOUD_ENV_PATH);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fail(".env.cloud.local is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") is not a valid URL.`);
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  if (parsed.protocol !== "https:" || localHostnames.has(parsed.hostname.toLowerCase()) || parsed.hostname.endsWith(".local")) {
    fail(`NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") does not look like a real cloud Supabase project. Refusing to run.`);
  }
  console.log(`Target: ${green(parsed.hostname)}`);
  console.log(`Operator email: ${green(email)}`);
  console.log(`Mode: ${confirm ? red("LIVE — will write") : yellow("DRY RUN — no writes")}\n`);

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Step 1: organisation, idempotent by slug (see ensureOrganisation's own doc comment).
  console.log(blue("Step 1/3: Villiz Pixels organisation"));
  let organisationId: string;
  try {
    const result = await ensureOrganisation(
      {
        findOrganisationBySlug: async (slug) => {
          const { data, error } = await client.from("organisations").select("id").eq("slug", slug).limit(1);
          if (error) throw error;
          return data && data.length > 0 ? { id: data[0]!.id } : null;
        },
        createOrganisation: async (input) => {
          const { data, error } = await client
            .from("organisations")
            .insert({ name: input.name, slug: input.slug, status: "active" })
            .select("id")
            .single();
          if (error) throw error;
          return { id: data!.id };
        },
      },
      { name: ORGANISATION_NAME, slug: ORGANISATION_SLUG, confirm },
    );
    console.log(result.outcome === "would_create" ? yellow(result.message) : green(`✔ ${result.message}`));
    organisationId = result.organisationId ?? "[not created — dry run]";
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  // Step 2: staff profile, idempotent by email — creates the auth user first if needed.
  console.log(blue("\nStep 2/3: Staff profile"));
  const { data: existingProfiles, error: profileLookupError } = await client
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .limit(1);
  if (profileLookupError) fail(`Failed to look up profile: ${profileLookupError.message}`);

  let profileId: string;
  if (existingProfiles && existingProfiles.length > 0) {
    profileId = existingProfiles[0]!.id;
    console.log(green(`✔ Profile for ${email} already exists (${profileId}) — skipping.`));
  } else if (!confirm) {
    console.log(yellow(`Would look up or create an auth user for ${email}, then create a profile row (role: owner).`));
    profileId = "[not created — dry run]";
  } else {
    // The admin API has no direct getUserByEmail — list and filter
    // client-side. Cloud pilot user counts are small; a single unpaginated
    // page is sufficient here.
    const { data: listedUsers, error: listUsersError } = await client.auth.admin.listUsers();
    if (listUsersError) fail(`Failed to list auth users: ${listUsersError.message}`);
    let authUser = listedUsers!.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;

    if (!authUser) {
      const { data: created, error: createUserError } = await client.auth.admin.createUser({ email, email_confirm: true });
      if (createUserError) fail(`Failed to create auth user: ${createUserError.message}`);
      authUser = created.user;
      console.log(green(`✔ Created auth user for ${email}.`));
    } else {
      console.log(green(`✔ Auth user for ${email} already exists — reusing.`));
    }

    const { data: createdProfile, error: createProfileError } = await client
      .from("profiles")
      .insert({ id: authUser.id, email, role: "owner", is_active: true })
      .select("id")
      .single();
    if (createProfileError) fail(`Failed to create profile: ${createProfileError.message}`);
    profileId = createdProfile!.id;
    console.log(green(`✔ Created profile for ${email} (${profileId}), role: owner.`));
  }

  // Step 3: link profile to organisation, idempotent on the (organisation_id, profile_id) pair.
  console.log(blue("\nStep 3/3: Organisation membership"));
  if (!confirm) {
    console.log(yellow("Would link the profile to the organisation as 'lead' (if both were created above)."));
  } else {
    const { data: existingMembership, error: membershipLookupError } = await client
      .from("organisation_members")
      .select("organisation_id, profile_id")
      .eq("organisation_id", organisationId)
      .eq("profile_id", profileId)
      .limit(1);
    if (membershipLookupError) fail(`Failed to look up organisation membership: ${membershipLookupError.message}`);

    if (existingMembership && existingMembership.length > 0) {
      console.log(green("✔ Membership already exists — skipping."));
    } else {
      const { error: createMembershipError } = await client
        .from("organisation_members")
        .insert({ organisation_id: organisationId, profile_id: profileId, role: "lead" });
      if (createMembershipError) fail(`Failed to create organisation membership: ${createMembershipError.message}`);
      console.log(green("✔ Linked profile to organisation as 'lead'."));
    }
  }

  console.log(blue("\n=== Bootstrap complete ==="));
  if (!confirm) {
    console.log(yellow("This was a dry run — nothing was written. Re-run with --confirm to apply."));
  }
}

// tsconfig.json targets ESM ("module": "esnext") — `require.main === module`
// doesn't exist in that world (and would throw a ReferenceError the moment a
// test file imports ensureOrganisation from this module). This is the ESM
// equivalent: true only when this file is the actual process entrypoint
// (`tsx scripts/cloud-bootstrap.ts`), false when merely imported for its
// exports. Both sides are resolved through realpathSync — a plain string
// comparison of import.meta.url against `file://${process.argv[1]}` looks
// right but silently never matches on macOS, where /tmp (and other paths)
// are symlinks: import.meta.url reports the resolved /private/... path
// while process.argv[1] keeps whatever path the shell was given, so the two
// never compare equal even when this genuinely is the direct invocation —
// main() would then just never run, with no error, on every real CLI use.
function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(red(`✘ Cloud bootstrap crashed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  });
}
