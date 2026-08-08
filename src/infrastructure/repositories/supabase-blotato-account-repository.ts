import "server-only";
import type { BlotatoAccountRepository } from "@/core/application/ports/blotato-account-port";
import type { BlotatoAccount, BlotatoAccountSummary } from "@/core/domain/entities/blotato";
import type { GenesisClient } from "../supabase/server-client";
import type { Database } from "../supabase/database.types";

type BlotatoAccountRow =
  Database["public"]["Tables"]["blotato_accounts"]["Row"];
import { translateError, unwrap } from "./errors";

type ExtendedRow = BlotatoAccountRow & {
  organisation_id?: string | null;
  active?: boolean | null;
  resolved_account_id?: string | null;
};

function toBlotatoAccount(row: BlotatoAccountRow): BlotatoAccount {
  const r = row as ExtendedRow;
  return {
    id: row.blotato_account_id,
    platform: row.platform,
    fullname: row.fullname,
    username: row.username,
    organisationId: r.organisation_id ?? null,
    active: r.active ?? true,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .eq("organisation_id" as any, organisationId)
      .order("last_verified_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) translateError(error, "Blotato account");
    return data ? toBlotatoAccount(data as BlotatoAccountRow) : null;
  }

  async findActiveForOrganisationAndPlatform(blotatoPlatform: string, organisationId: string): Promise<BlotatoAccount[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.client.from("blotato_accounts").select("*") as any)
      .eq("platform", blotatoPlatform)
      .eq("organisation_id", organisationId)
      .eq("active", true)
      .order("last_verified_at", { ascending: false });

    if (error) translateError(error as Parameters<typeof translateError>[0], "Blotato account");
    return ((data ?? []) as BlotatoAccountRow[]).map(toBlotatoAccount);
  }

  async listActiveForOrganisation(organisationId: string): Promise<BlotatoAccount[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.client.from("blotato_accounts").select("*") as any)
      .eq("organisation_id", organisationId)
      .eq("active", true)
      .order("platform", { ascending: true });

    if (error) translateError(error as Parameters<typeof translateError>[0], "Blotato account");
    return ((data ?? []) as BlotatoAccountRow[]).map(toBlotatoAccount);
  }

  async assignToOrganisation(blotatoAccountId: string, organisationId: string): Promise<BlotatoAccount> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.client.from("blotato_accounts") as any)
      .update({ organisation_id: organisationId, active: true })
      .eq("blotato_account_id", blotatoAccountId)
      .select("*")
      .maybeSingle();

    if (error) translateError(error as Parameters<typeof translateError>[0], "Blotato account");
    if (!data) throw new Error(`Blotato account ${blotatoAccountId} not found`);
    return toBlotatoAccount(data as BlotatoAccountRow);
  }

  async removeFromOrganisation(blotatoAccountId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (this.client.from("blotato_accounts") as any)
      .update({ active: false, organisation_id: null })
      .eq("blotato_account_id", blotatoAccountId);

    if (error) translateError(error as Parameters<typeof translateError>[0], "Blotato account");
  }
}
