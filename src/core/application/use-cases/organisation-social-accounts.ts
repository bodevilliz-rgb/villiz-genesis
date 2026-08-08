import type { Actor } from "@/core/domain/entities/identity";
import { ForbiddenError, LimitExceededError, ConflictError } from "@/core/domain/errors";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { UsageRepository } from "@/core/application/ports/usage-port";

interface ChannelDeps {
  actor: Actor;
  blotatoAccounts: BlotatoAccountRepository;
  usage: UsageRepository;
}

/** All active channels assigned to an org. No auth gate — readable by any org member via the settings page. */
export async function listOrganisationChannels(
  deps: Pick<ChannelDeps, "blotatoAccounts">,
  organisationId: string,
): Promise<BlotatoAccount[]> {
  return deps.blotatoAccounts.listActiveForOrganisation(organisationId);
}

/** All Blotato accounts not yet assigned to any org. Only platform admins may see this. */
export async function listAvailableAccountsForAssignment(
  deps: Pick<ChannelDeps, "actor" | "blotatoAccounts">,
): Promise<BlotatoAccount[]> {
  if (!deps.actor.isPlatformAdmin) {
    throw new ForbiddenError("Only platform administrators may list available accounts for assignment.");
  }
  const all = await deps.blotatoAccounts.listAccounts();
  return all.filter((a) => a.organisationId === null && a.active);
}

/** Assigns a Blotato account to an org. Enforces the org's max_social_accounts guardrail. */
export async function assignChannelToOrganisation(
  deps: ChannelDeps,
  { organisationId, blotatoAccountId }: { organisationId: string; blotatoAccountId: string },
): Promise<BlotatoAccount> {
  if (!deps.actor.isPlatformAdmin) {
    throw new ForbiddenError("Only platform administrators may assign social accounts to organisations.");
  }

  const usage = await deps.usage.forOrganisation(organisationId);
  if (!usage) throw new Error(`Organisation ${organisationId} not found`);

  const current = await deps.blotatoAccounts.listActiveForOrganisation(organisationId);
  if (current.length >= usage.maxSocialAccounts) {
    throw new LimitExceededError(
      `This organisation has reached its channel limit (${usage.maxSocialAccounts}). Remove an existing channel or ask a platform administrator to increase the limit.`,
    );
  }

  const all = await deps.blotatoAccounts.listAccounts();
  const target = all.find((a) => a.id === blotatoAccountId);
  if (target?.organisationId && target.organisationId !== organisationId) {
    throw new ConflictError(
      `This account is already assigned to a different organisation. Remove it from that organisation first.`,
    );
  }

  return deps.blotatoAccounts.assignToOrganisation(blotatoAccountId, organisationId);
}

/** Removes a channel from its org and marks it inactive. The row is preserved for history and can be re-assigned. */
export async function removeChannelFromOrganisation(
  deps: Pick<ChannelDeps, "actor" | "blotatoAccounts">,
  { blotatoAccountId }: { blotatoAccountId: string },
): Promise<void> {
  if (!deps.actor.isPlatformAdmin) {
    throw new ForbiddenError("Only platform administrators may remove social accounts from organisations.");
  }
  return deps.blotatoAccounts.removeFromOrganisation(blotatoAccountId);
}
