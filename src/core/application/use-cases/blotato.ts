import type { Actor } from "@/core/domain/entities/identity";
import { ForbiddenError } from "@/core/domain/errors";
import {
  supportedPlatformsFromAccounts,
  type BlotatoAccount,
  type BlotatoConnectionTestResult,
} from "@/core/domain/entities/blotato";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoClient } from "@/core/application/ports/blotato-client-port";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";

interface BlotatoDeps {
  actor: Actor;
  blotatoClient: BlotatoClient;
  blotatoAccounts: BlotatoAccountRepository;
}

/**
 * Requirement 1/2/6/7 in one place: verifies the configured API key by
 * actually calling Blotato (never assumes success from the key merely being
 * present), retrieves every connected account, and — only on success —
 * persists them via BlotatoAccountRepository.upsertAccounts so they're
 * available to BlotatoPublisherBase for a future real publish without
 * requiring another Test Connection click first.
 *
 * Never throws for a reachability failure — an unreachable API or an
 * invalid key is a normal, expected outcome the caller (the Test Connection
 * button) needs to render, not an exception to handle. It does throw
 * ForbiddenError for a non-admin actor, since that's a genuine authorisation
 * failure, not a connection-test result.
 */
export async function testBlotatoConnection(deps: BlotatoDeps): Promise<BlotatoConnectionTestResult> {
  if (!deps.actor.isPlatformAdmin) {
    throw new ForbiddenError("Only platform administrators may test the Blotato connection.");
  }

  const config = blotatoConfig();
  if (!config.enabled || !config.apiKey) {
    return {
      reachable: false,
      accounts: [],
      supportedPlatforms: [],
      error: "Blotato is not configured. Set BLOTATO_API_KEY and BLOTATO_ENABLED=true in the environment.",
    };
  }

  let summaries;
  try {
    summaries = await deps.blotatoClient.listAccounts();
  } catch (error) {
    return {
      reachable: false,
      accounts: [],
      supportedPlatforms: [],
      error: error instanceof Error ? error.message : "Could not reach Blotato.",
    };
  }

  // organisation_id is null here — testBlotatoConnection is a platform-wide
  // admin action with no org context. Rows stored this way are visible in
  // the settings UI but blocked from driving a real publish until an operator
  // backfills organisation_id (documented in the 20260807120000 migration).
  const stored = await deps.blotatoAccounts.upsertAccounts(summaries, null);

  return {
    reachable: true,
    accounts: stored,
    supportedPlatforms: supportedPlatformsFromAccounts(summaries),
    error: null,
  };
}

/** Read-only — every authenticated staff member may see what's already stored, not just platform admins (see the migration's RLS comment). */
export async function listStoredBlotatoAccounts(
  deps: Pick<BlotatoDeps, "blotatoAccounts">,
): Promise<BlotatoAccount[]> {
  return deps.blotatoAccounts.listAccounts();
}
