import "server-only";
import type { UsageRepository } from "@/core/application/ports/usage-port";
import type { OrganisationUsage } from "@/core/domain/entities/usage";
import type { GenesisClient } from "../supabase/server-client";
import type { UsageSnapshotRow } from "../supabase/database.types";
import { translateError } from "./errors";

/**
 * Postgres cannot express nullability for view columns, so the generated
 * contract types every field as nullable even though the view coalesces all of
 * them. Rather than override the generated type with a claim the compiler
 * cannot check, default here: a usage meter that reads zero is recoverable, a
 * meter that reads NaN is not.
 */
function toUsage(row: UsageSnapshotRow): OrganisationUsage {
  return {
    organisationId: row.organisation_id ?? "",
    socialAccountsUsed: row.social_accounts_used ?? 0,
    postsThisWeek: row.posts_this_week ?? 0,
    storageBytesUsed: Number(row.storage_bytes_used ?? 0),
    aiTokensThisMonth: Number(row.ai_tokens_this_month ?? 0),
    membrainEntriesUsed: row.membrain_entries_used ?? 0,
    maxSocialAccounts: row.max_social_accounts ?? 0,
    maxPostsPerWeek: row.max_posts_per_week ?? 0,
    maxStorageBytes: Number(row.max_storage_bytes ?? 0),
    maxAiTokensPerMonth: Number(row.max_ai_tokens_per_month ?? 0),
    maxMembrainEntries: row.max_membrain_entries ?? 0,
  };
}

export class SupabaseUsageRepository implements UsageRepository {
  constructor(private readonly client: GenesisClient) {}

  async forOrganisation(organisationId: string): Promise<OrganisationUsage | null> {
    const { data, error } = await this.client
      .from("organisation_usage_snapshot")
      .select("*")
      .eq("organisation_id", organisationId)
      .maybeSingle();

    if (error) translateError(error, "Usage snapshot");
    return data ? toUsage(data) : null;
  }

  async forAllVisibleOrganisations(): Promise<OrganisationUsage[]> {
    const { data, error } = await this.client.from("organisation_usage_snapshot").select("*");
    if (error) translateError(error, "Usage snapshot");
    return (data ?? []).map(toUsage);
  }

  async updateLimits(input: {
    organisationId: string;
    maxSocialAccounts: number;
    maxPostsPerWeek: number;
    maxStorageBytes: number;
    maxAiTokensPerMonth: number;
    maxMembrainEntries: number;
  }): Promise<void> {
    const { error } = await this.client
      .from("organisation_limits")
      .update({
        max_social_accounts: input.maxSocialAccounts,
        max_posts_per_week: input.maxPostsPerWeek,
        max_storage_bytes: input.maxStorageBytes,
        max_ai_tokens_per_month: input.maxAiTokensPerMonth,
        max_membrain_entries: input.maxMembrainEntries,
      })
      .eq("organisation_id", input.organisationId);

    if (error) translateError(error, "Limit update");
  }
}
