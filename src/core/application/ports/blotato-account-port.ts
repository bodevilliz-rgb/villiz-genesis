import type { BlotatoAccount, BlotatoAccountSummary } from "@/core/domain/entities/blotato";

/**
 * Storage for the accounts Blotato reports as connected. The only writer is
 * testBlotatoConnection(); everything else only ever reads.
 */
export interface BlotatoAccountRepository {
  /**
   * Inserts any account not seen before and refreshes `lastVerifiedAt` (plus
   * fullname/username, in case they changed) for ones already stored.
   * Never deletes a row an operator no longer sees from Blotato — a
   * disconnected account should stay visible as history until an operator
   * explicitly removes it, not silently disappear the next time someone
   * clicks Test Connection.
   *
   * `organisationId` is null when called from a platform-wide Test Connection
   * without org context (legacy/settings page flow before Sprint 10B). Rows
   * with a null organisation_id cannot be used by the publishing worker —
   * they must be backfilled before live publishing works for that org.
   */
  upsertAccounts(accounts: BlotatoAccountSummary[], organisationId: string | null): Promise<BlotatoAccount[]>;
  listAccounts(): Promise<BlotatoAccount[]>;
  /**
   * Returns the most recently verified account scoped to `organisationId` for
   * the given Blotato platform string. NEVER falls back to null-org rows or
   * another org's account — if this org has no verified account, returns null
   * and the caller must fail safely.
   */
  findMostRecentForPlatform(blotatoPlatform: string, organisationId: string): Promise<BlotatoAccount | null>;
  /**
   * Returns ALL active accounts scoped to `organisationId` for the given Blotato
   * platform string. Used by the publisher to distinguish:
   *   0 rows → fail closed (no account connected)
   *   1 row  → use it
   *   2+ rows → fail closed unless a resolvedAccountId destination lock is present
   */
  findActiveForOrganisationAndPlatform(blotatoPlatform: string, organisationId: string): Promise<BlotatoAccount[]>;
  /** All active accounts for an org — used by the Connected Channels panel. */
  listActiveForOrganisation(organisationId: string): Promise<BlotatoAccount[]>;
  /** Assigns a Blotato account to an org and marks it active. Throws if the account is already owned by a different org. */
  assignToOrganisation(blotatoAccountId: string, organisationId: string): Promise<BlotatoAccount>;
  /** Marks a Blotato account inactive and clears its org assignment. The row is kept for history. */
  removeFromOrganisation(blotatoAccountId: string): Promise<void>;
}
