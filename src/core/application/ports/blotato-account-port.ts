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
}
