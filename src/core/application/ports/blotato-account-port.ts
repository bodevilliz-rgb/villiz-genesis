import type { BlotatoAccount, BlotatoAccountSummary } from "@/core/domain/entities/blotato";

/**
 * Storage for the accounts Blotato reports as connected — platform-wide, not
 * organisation-scoped (see the migration's own comment for why). The only
 * writer is testBlotatoConnection(); everything else only ever reads.
 */
export interface BlotatoAccountRepository {
  /**
   * Inserts any account not seen before and refreshes `lastVerifiedAt` (plus
   * fullname/username, in case they changed) for ones already stored.
   * Never deletes a row an operator no longer sees from Blotato — a
   * disconnected account should stay visible as history until an operator
   * explicitly removes it, not silently disappear the next time someone
   * clicks Test Connection.
   */
  upsertAccounts(accounts: BlotatoAccountSummary[]): Promise<BlotatoAccount[]>;
  listAccounts(): Promise<BlotatoAccount[]>;
  /** The most recently verified stored account for a given platform, if any — used by BlotatoPublisherBase to resolve which Blotato accountId to publish through. */
  findMostRecentForPlatform(blotatoPlatform: string): Promise<BlotatoAccount | null>;
}
