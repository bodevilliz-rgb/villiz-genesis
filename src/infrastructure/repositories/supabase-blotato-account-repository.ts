import "server-only";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoAccount, BlotatoAccountSummary } from "@/core/domain/entities/blotato";
import type { GenesisClient } from "../supabase/server-client";
import type { Database } from "../supabase/database.types";

type BlotatoAccountRow =
  Database["public"]["Tables"]["blotato_accounts"]["Row"];
import { translateError, unwrap } from "./errors";

function toBlotatoAccount(row: BlotatoAccountRow): BlotatoAccount {
  return {
    id: row.blotato_account_id,
    platform: row.platform,
    fullname: row.fullname,
    username: row.username,
    organisationId: (row as BlotatoAccountRow & { organisation_id?: string | null }).organisation_id ?? null,
    firstConnectedAt: row.first_connected_at,
    lastVerifiedAt: row.last_verified_at,
  };
}

/**
 * The only concrete implementation of BlotatoAccountRepository. Writes go
 * through the RLS-bound request client — `blotato_accounts_insert`/`_update`
 * restrict writes to app.is_platform_admin(), so an operator without that
 * role gets a real 403-shaped Postgres error, not a silently-accepted write.
 */
export class SupabaseBlotatoAccountRepository implements BlotatoAccountRepository {
  constructor(private readonly client: GenesisClient) {}

  async upsertAccounts(accounts: BlotatoAccountSummary[], organisationId: string | null): Promise<BlotatoAccount[]> {
    if (accounts.length === 0) return [];

    const now = new Date().toISOString();
    const payload = accounts.map((account) => ({
      blotato_account_id: account.id,
      platform: account.platform,
      fullname: account.fullname,
      username: account.username,
      last_verified_at: now,
      organisation_id: organisationId,
    }));

    const result = await this.client
      .from("blotato_accounts")
      // organisation_id exists in DB (migration 20260807120000) but is not yet
      // in the generated types — cast required until types are regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any[], { onConflict: "blotato_account_id" })
      .select("*");

    const rows = unwrap(result, "Blotato account");
    return (rows as BlotatoAccountRow[]).map(toBlotatoAccount);
  }

  async listAccounts(): Promise<BlotatoAccount[]> {
    const result = await this.client.from("blotato_accounts").select("*").order("platform", { ascending: true });
    const rows = unwrap(result, "Blotato account");
    return (rows as BlotatoAccountRow[]).map(toBlotatoAccount);
  }

  async findMostRecentForPlatform(blotatoPlatform: string, organisationId: string): Promise<BlotatoAccount | null> {
    const { data, error } = await this.client
      .from("blotato_accounts")
      .select("*")
      .eq("platform", blotatoPlatform)
      // organisation_id exists in DB but not yet in generated types — see above
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .eq("organisation_id" as any, organisationId)
      .order("last_verified_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) translateError(error, "Blotato account");
    return data ? toBlotatoAccount(data as BlotatoAccountRow) : null;
  }
}
