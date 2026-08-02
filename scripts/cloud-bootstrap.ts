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

/**
 * This script bootstraps exactly one staff owner account — whichever email
 * you pass via --email — for the Villiz Pixels cloud pilot. full_name and
 * role are fixed for the same reason ORGANISATION_NAME/ORGANISATION_SLUG are:
 * this is a narrow, single-purpose bootstrap, not a general user-management
 * tool.
 */
const STAFF_FULL_NAME = "Bode Villiz";
const STAFF_ROLE = "owner";
const MEMBERSHIP_ROLE = "lead";

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const blue = (text: string) => `\x1b[34m${text}\x1b[0m`;

function fail(message: string): never {
  console.error(red(`✘ ${message}`));
  process.exit(1);
}

/**
 * Supabase/PostgREST errors (PostgrestError, AuthError, StorageError) are
 * plain objects, not Error instances — `String(error)` or `${error}` on one
 * of those produces the literally useless "[object Object]", which is
 * exactly what hid the real cause of a previous bootstrap failure here
 * (see tests/cloud-bootstrap.test.ts's "formatSupabaseError" suite for the
 * exact shape that triggered it).
 *
 * Only ever reads a fixed, known-safe set of fields — message/code/details/
 * hint/status/statusCode. It never spreads or JSON.stringifies the whole
 * error object, so a key, token, or header attached to the error for
 * unrelated reasons can never leak through it.
 */
export function formatSupabaseError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  // A bare string throw carries no hidden keys/tokens to leak — pass it
  // through directly, same as the previous String(error) behaviour.
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (error && typeof error === "object") {
    const shape = error as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof shape.message === "string" && shape.message.length > 0) {
      parts.push(shape.message);
    }
    if (typeof shape.code === "string" || typeof shape.code === "number") {
      parts.push(`code=${shape.code}`);
    }
    const status = shape.status ?? shape.statusCode;
    if (typeof status === "string" || typeof status === "number") {
      parts.push(`status=${status}`);
    }
    if (typeof shape.details === "string" && shape.details.length > 0) {
      parts.push(`details=${shape.details}`);
    }
    if (typeof shape.hint === "string" && shape.hint.length > 0) {
      parts.push(`hint=${shape.hint}`);
    }

    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  return "Unknown error (a non-Error, non-object, non-string value was thrown)";
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
      `Failed to create organisation "${input.name}" (slug: "${input.slug}"): ${formatSupabaseError(error)}`,
    );
  }
  return {
    organisationId: created.id,
    outcome: "created",
    message: `Organisation created: "${input.name}" (slug: "${input.slug}", id: ${created.id}).`,
  };
}

export interface AuthUserRecord {
  id: string;
  email: string;
}

export interface EnsureAuthUserDeps {
  /** List + filter client-side — the admin API has no direct getUserByEmail. Read-only, must never throw for "not found" (return null instead). */
  findAuthUserByEmail: (email: string) => Promise<AuthUserRecord | null>;
  /** auth.admin.createUser — only ever called when no existing user was found. */
  createAuthUser: (email: string) => Promise<AuthUserRecord>;
}

export type EnsureAuthUserOutcome = "found" | "created" | "would_create";

export interface EnsureAuthUserResult {
  authUser: AuthUserRecord | null;
  outcome: EnsureAuthUserOutcome;
  message: string;
}

/**
 * Resolves the Auth user for the operator email, creating it only if it
 * genuinely doesn't exist yet. The lookup itself is a read and is always
 * safe to run — including in dry-run mode — so dry runs can report an
 * accurate "found" vs "would create" without ever calling createUser.
 */
export async function ensureAuthUser(deps: EnsureAuthUserDeps, email: string, confirm: boolean): Promise<EnsureAuthUserResult> {
  const existing = await deps.findAuthUserByEmail(email);
  if (existing) {
    return { authUser: existing, outcome: "found", message: `Auth user for ${email} already exists (${existing.id}) — reusing.` };
  }

  if (!confirm) {
    return { authUser: null, outcome: "would_create", message: `Auth user for ${email} not found — would create it.` };
  }

  const created = await deps.createAuthUser(email);
  return { authUser: created, outcome: "created", message: `Created auth user for ${email} (${created.id}).` };
}

export interface ProfileRecord {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
}

export interface EnsureStaffProfileDeps {
  /** SELECT ... FROM profiles WHERE id = $1 — by primary key, never by email (that's the bug this fixes). Read-only. */
  findProfileById: (id: string) => Promise<ProfileRecord | null>;
  /** INSERT INTO profiles — only called when no row exists for this id. */
  createProfile: (input: { id: string; email: string; full_name: string; role: string }) => Promise<ProfileRecord>;
  /** UPDATE profiles SET ... WHERE id = $1 — only ever touches the fields passed in `fields`; every other column is left alone. */
  updateProfile: (id: string, fields: Partial<{ email: string; full_name: string; role: string; is_active: boolean }>) => Promise<ProfileRecord>;
}

export interface EnsureStaffProfileInput {
  authUserId: string;
  email: string;
  fullName: string;
  role: string;
  confirm: boolean;
}

export type EnsureStaffProfileOutcome = "created" | "found_complete" | "updated" | "would_create" | "would_update";

export interface EnsureStaffProfileResult {
  profileId: string | null;
  outcome: EnsureStaffProfileOutcome;
  message: string;
}

/**
 * The fix for "duplicate key value violates unique constraint profiles_pkey":
 * looks up the profile by primary key (the Auth user's id), never by email.
 * A profile row is reused whenever one exists for that id — it is only ever
 * inserted when truly absent. If it exists but is missing/wrong on the
 * fields this bootstrap owns (email, full_name, role, is_active), only
 * those fields are updated; every other column (avatar_url, job_title,
 * last_seen_at, etc.) is left exactly as it was.
 */
export async function ensureStaffProfile(deps: EnsureStaffProfileDeps, input: EnsureStaffProfileInput): Promise<EnsureStaffProfileResult> {
  const existing = await deps.findProfileById(input.authUserId);

  if (!existing) {
    if (!input.confirm) {
      return {
        profileId: null,
        outcome: "would_create",
        message: `Profile for ${input.email} not found by id (${input.authUserId}) — would create it (role: ${input.role}).`,
      };
    }
    const created = await deps.createProfile({ id: input.authUserId, email: input.email, full_name: input.fullName, role: input.role });
    return {
      profileId: created.id,
      outcome: "created",
      message: `Profile created for ${input.email} (${created.id}), role: ${input.role}.`,
    };
  }

  const fieldsToUpdate: Partial<{ email: string; full_name: string; role: string; is_active: boolean }> = {};
  if (existing.email !== input.email) fieldsToUpdate.email = input.email;
  if (existing.full_name !== input.fullName) fieldsToUpdate.full_name = input.fullName;
  if (existing.role !== input.role) fieldsToUpdate.role = input.role;
  if (existing.is_active !== true) fieldsToUpdate.is_active = true;

  if (Object.keys(fieldsToUpdate).length === 0) {
    return {
      profileId: existing.id,
      outcome: "found_complete",
      message: `Profile for ${input.email} already exists and is complete (${existing.id}) — reusing.`,
    };
  }

  const changedFields = Object.keys(fieldsToUpdate).join(", ");
  if (!input.confirm) {
    return {
      profileId: existing.id,
      outcome: "would_update",
      message: `Profile for ${input.email} exists (${existing.id}) but needs updating: ${changedFields} — would update.`,
    };
  }

  const updated = await deps.updateProfile(existing.id, fieldsToUpdate);
  return {
    profileId: updated.id,
    outcome: "updated",
    message: `Profile for ${input.email} updated (${updated.id}): ${changedFields}.`,
  };
}

export interface MembershipRecord {
  organisation_id: string;
  profile_id: string;
  role: string;
}

export interface EnsureOrganisationMembershipDeps {
  /** SELECT ... FROM organisation_members WHERE organisation_id = $1 AND profile_id = $2 — read-only. */
  findMembership: (organisationId: string, profileId: string) => Promise<MembershipRecord | null>;
  /** INSERT INTO organisation_members — only called when no row exists for this (organisation_id, profile_id) pair. */
  createMembership: (input: { organisation_id: string; profile_id: string; role: string }) => Promise<void>;
  /** UPDATE organisation_members SET role = $3 WHERE organisation_id = $1 AND profile_id = $2. */
  updateMembershipRole: (organisationId: string, profileId: string, role: string) => Promise<void>;
}

export interface EnsureOrganisationMembershipInput {
  organisationId: string;
  profileId: string;
  role: string;
  confirm: boolean;
}

export type EnsureOrganisationMembershipOutcome = "created" | "found_complete" | "updated" | "would_create" | "would_update";

export interface EnsureOrganisationMembershipResult {
  outcome: EnsureOrganisationMembershipOutcome;
  message: string;
}

/** Idempotent on the (organisation_id, profile_id) pair — reuses an existing membership, updating its role only if it's wrong, and never inserts a duplicate. */
export async function ensureOrganisationMembership(
  deps: EnsureOrganisationMembershipDeps,
  input: EnsureOrganisationMembershipInput,
): Promise<EnsureOrganisationMembershipResult> {
  const existing = await deps.findMembership(input.organisationId, input.profileId);

  if (!existing) {
    if (!input.confirm) {
      return { outcome: "would_create", message: `Would link profile to organisation as '${input.role}'.` };
    }
    await deps.createMembership({ organisation_id: input.organisationId, profile_id: input.profileId, role: input.role });
    return { outcome: "created", message: `Linked profile to organisation as '${input.role}'.` };
  }

  if (existing.role === input.role) {
    return { outcome: "found_complete", message: `Membership already exists with role '${input.role}' — reusing.` };
  }

  if (!input.confirm) {
    return { outcome: "would_update", message: `Membership exists with role '${existing.role}' — would update to '${input.role}'.` };
  }

  await deps.updateMembershipRole(input.organisationId, input.profileId, input.role);
  return { outcome: "updated", message: `Membership role updated from '${existing.role}' to '${input.role}'.` };
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
    fail(formatSupabaseError(error));
  }

  // Step 2: Auth user, idempotent by email, then staff profile, idempotent by primary key (id).
  console.log(blue("\nStep 2/3: Staff profile"));
  let profileId: string;
  try {
    const authUserResult = await ensureAuthUser(
      {
        findAuthUserByEmail: async (lookupEmail) => {
          // The admin API has no direct getUserByEmail — list and filter
          // client-side. Cloud pilot user counts are small; a single
          // unpaginated page is sufficient here.
          const { data, error } = await client.auth.admin.listUsers();
          if (error) throw error;
          const match = data.users.find((u) => u.email?.toLowerCase() === lookupEmail.toLowerCase());
          return match ? { id: match.id, email: match.email! } : null;
        },
        createAuthUser: async (createEmail) => {
          const { data, error } = await client.auth.admin.createUser({ email: createEmail, email_confirm: true });
          if (error) throw error;
          return { id: data.user.id, email: data.user.email! };
        },
      },
      email,
      confirm,
    );
    console.log(authUserResult.outcome === "would_create" ? yellow(authUserResult.message) : green(`✔ ${authUserResult.message}`));

    if (!authUserResult.authUser) {
      console.log(yellow(`Would create profile for ${email} (role: ${STAFF_ROLE}) once the auth user exists.`));
      profileId = "[not created — dry run]";
    } else {
      const authUserId = authUserResult.authUser.id;
      const profileResult = await ensureStaffProfile(
        {
          findProfileById: async (id) => {
            const { data, error } = await client.from("profiles").select("id, email, full_name, role, is_active").eq("id", id).maybeSingle();
            if (error) throw error;
            return data ?? null;
          },
          createProfile: async (input) => {
            const { data, error } = await client
              .from("profiles")
              .insert({ id: input.id, email: input.email, full_name: input.full_name, role: input.role, is_active: true })
              .select("id, email, full_name, role, is_active")
              .single();
            if (error) throw error;
            return data!;
          },
          // profiles_guard_self_escalation blocks any UPDATE that changes
          // role/is_active unless app.is_platform_admin() is true — which
          // is never true for a service-role connection (auth.uid() has no
          // JWT `sub` claim to read). A plain `.update()` here always hits
          // that guard and fails with 42501. bootstrap_activate_profile
          // (see the migration of the same name) is the one-time, narrowly
          // scoped RPC that performs exactly this update instead — it only
          // ever runs while zero active admins exist anywhere in the
          // project, so `fields` (the specific diff) doesn't matter here:
          // the RPC always sets the complete, correct bootstrap-owned
          // target state, which is a safe no-op for any field that was
          // already correct.
          updateProfile: async (id) => {
            const { data, error } = await client.rpc("bootstrap_activate_profile", {
              p_user_id: id,
              p_email: email,
              p_full_name: STAFF_FULL_NAME,
              p_role: STAFF_ROLE,
            });
            if (error) throw error;
            return data as ProfileRecord;
          },
        },
        { authUserId, email, fullName: STAFF_FULL_NAME, role: STAFF_ROLE, confirm },
      );
      console.log(
        profileResult.outcome === "would_create" || profileResult.outcome === "would_update"
          ? yellow(profileResult.message)
          : green(`✔ ${profileResult.message}`),
      );
      profileId = profileResult.profileId ?? "[not created — dry run]";
    }
  } catch (error) {
    fail(formatSupabaseError(error));
  }

  // Step 3: link profile to organisation, idempotent on the (organisation_id, profile_id) pair.
  console.log(blue("\nStep 3/3: Organisation membership"));
  const DRY_RUN_PLACEHOLDER = "[not created — dry run]";
  if (organisationId === DRY_RUN_PLACEHOLDER || profileId === DRY_RUN_PLACEHOLDER) {
    // Neither id is real yet (nothing to look up or link against) — this is
    // only reachable in dry-run mode, since confirm mode always resolves
    // both ids above or exits via fail() first.
    console.log(yellow(`Would link the profile to the organisation as '${MEMBERSHIP_ROLE}' (once both are created above).`));
  } else {
    try {
      const membershipResult = await ensureOrganisationMembership(
        {
          findMembership: async (organisationIdArg, profileIdArg) => {
            const { data, error } = await client
              .from("organisation_members")
              .select("organisation_id, profile_id, role")
              .eq("organisation_id", organisationIdArg)
              .eq("profile_id", profileIdArg)
              .maybeSingle();
            if (error) throw error;
            return data ?? null;
          },
          createMembership: async (input) => {
            const { error } = await client.from("organisation_members").insert(input);
            if (error) throw error;
          },
          updateMembershipRole: async (organisationIdArg, profileIdArg, role) => {
            const { error } = await client
              .from("organisation_members")
              .update({ role })
              .eq("organisation_id", organisationIdArg)
              .eq("profile_id", profileIdArg);
            if (error) throw error;
          },
        },
        { organisationId, profileId, role: MEMBERSHIP_ROLE, confirm },
      );
      console.log(
        membershipResult.outcome === "would_create" || membershipResult.outcome === "would_update"
          ? yellow(membershipResult.message)
          : green(`✔ ${membershipResult.message}`),
      );
    } catch (error) {
      fail(formatSupabaseError(error));
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
    console.error(red(`✘ Cloud bootstrap crashed: ${formatSupabaseError(error)}`));
    process.exit(1);
  });
}
