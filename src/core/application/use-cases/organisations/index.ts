/**
 * Organisation use cases.
 *
 * Style decision: use cases are plain async functions that receive their
 * dependencies explicitly rather than classes with injected constructors.
 * They are equally testable (pass a fake repository), carry no lifecycle, and
 * remove a layer of ceremony that adds nothing in a serverless runtime where
 * every request builds a fresh object graph anyway.
 */
import { ForbiddenError, ConflictError, NotFoundError, ValidationError } from "@/core/domain/errors";
import type { Actor } from "@/core/domain/entities/identity";
import type { Organisation, OrganisationSummary } from "@/core/domain/entities/organisation";
import type { OrganisationRepository, OrganisationWriteModel } from "@/core/application/ports/organisation-port";
import type { UsageRepository } from "@/core/application/ports/usage-port";
import {
  assignMemberSchema,
  createOrganisationSchema,
  removeMemberSchema,
  updateLimitsSchema,
  updateOrganisationSchema,
} from "@/core/application/dto/organisation-dto";
import { slugify } from "@/lib/slug";

interface OrganisationDeps {
  actor: Actor;
  organisations: OrganisationRepository;
}

const blank = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export async function listOrganisations(deps: OrganisationDeps): Promise<OrganisationSummary[]> {
  return deps.organisations.listForActor();
}

export async function getOrganisation(
  deps: OrganisationDeps,
  organisationId: string,
): Promise<Organisation> {
  const organisation = await deps.organisations.findById(organisationId);
  if (!organisation) throw new NotFoundError("Organisation");
  return organisation;
}

/**
 * Slug generation retries with a numeric suffix rather than failing, because
 * two clients genuinely can be called "Northside Dental".
 */
async function resolveSlug(
  repo: OrganisationRepository,
  name: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(name) || "client";
  let candidate = base;
  for (let attempt = 2; attempt <= 50; attempt += 1) {
    if (!(await repo.slugExists(candidate, excludeId))) return candidate;
    candidate = `${base}-${attempt}`;
  }
  throw new ConflictError("Too many clients share this name. Add a distinguishing word.");
}

export async function createOrganisation(
  deps: OrganisationDeps,
  raw: unknown,
): Promise<Organisation> {
  if (!deps.actor.isPlatformAdmin) {
    throw new ForbiddenError("Only platform administrators can onboard a new client.");
  }

  const parsed = createOrganisationSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the details below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  const slug = await resolveSlug(deps.organisations, input.name);

  return deps.organisations.create({
    ...toWriteModel(input, slug),
    createdBy: deps.actor.id,
  });
}

export async function updateOrganisation(
  deps: OrganisationDeps,
  raw: unknown,
): Promise<Organisation> {
  const parsed = updateOrganisationSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the details below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  const existing = await deps.organisations.findById(input.id);
  if (!existing) throw new NotFoundError("Organisation");

  // Slug is stable once assigned: it may already be referenced in stored URLs
  // and exported reports. It only changes if the name changes.
  const slug =
    existing.name.trim().toLowerCase() === input.name.trim().toLowerCase()
      ? existing.slug
      : await resolveSlug(deps.organisations, input.name, input.id);

  return deps.organisations.update(input.id, toWriteModel(input, slug));
}

function toWriteModel(
  input: {
    name: string;
    legalName?: string;
    industry?: string;
    websiteUrl?: string;
    status: Organisation["status"];
    brandColour?: string;
    primaryContactName?: string;
    primaryContactEmail?: string;
    notes?: string;
  },
  slug: string,
): OrganisationWriteModel {
  return {
    name: input.name.trim(),
    slug,
    legalName: blank(input.legalName),
    industry: blank(input.industry),
    websiteUrl: blank(input.websiteUrl),
    status: input.status,
    brandColour: blank(input.brandColour),
    primaryContactName: blank(input.primaryContactName),
    primaryContactEmail: blank(input.primaryContactEmail)?.toLowerCase() ?? null,
    notes: blank(input.notes),
  };
}

export async function assignOrganisationMember(deps: OrganisationDeps, raw: unknown): Promise<void> {
  const parsed = assignMemberSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Select a colleague and a role.");

  await deps.organisations.assignMember({
    ...parsed.data,
    assignedBy: deps.actor.id,
  });
}

export async function removeOrganisationMember(deps: OrganisationDeps, raw: unknown): Promise<void> {
  const parsed = removeMemberSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Select a colleague to remove.");

  const members = await deps.organisations.listMembers(parsed.data.organisationId);
  const leads = members.filter((m) => m.role === "lead");
  const target = members.find((m) => m.profileId === parsed.data.profileId);

  // An account without a lead has no accountable owner. Refuse to create one.
  if (target?.role === "lead" && leads.length === 1) {
    throw new ConflictError("Assign another account lead before removing this one.");
  }

  await deps.organisations.removeMember(parsed.data.organisationId, parsed.data.profileId);
}

export async function updateOrganisationLimits(
  deps: { actor: Actor; usage: UsageRepository },
  raw: unknown,
): Promise<void> {
  if (!deps.actor.isPlatformAdmin) {
    throw new ForbiddenError("Only platform administrators can change account limits.");
  }

  const parsed = updateLimitsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Check the limits below.", parsed.error.flatten().fieldErrors);

  const input = parsed.data;
  await deps.usage.updateLimits({
    organisationId: input.organisationId,
    maxSocialAccounts: input.maxSocialAccounts,
    maxPostsPerWeek: input.maxPostsPerWeek,
    maxStorageBytes: Math.round(input.maxStorageGb * 1024 * 1024 * 1024),
    maxAiTokensPerMonth: input.maxAiTokensPerMonth,
    maxMembrainEntries: input.maxMembrainEntries,
  });
}
