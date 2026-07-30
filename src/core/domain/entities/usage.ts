export interface UsageMetric {
  key: "social_accounts" | "posts_per_week" | "storage" | "ai_tokens" | "membrain_entries";
  label: string;
  used: number;
  limit: number;
  /** 0–1, capped at 1 for display. */
  ratio: number;
  state: "ok" | "approaching" | "exceeded";
  format: "count" | "bytes" | "tokens";
}

export interface OrganisationUsage {
  organisationId: string;
  socialAccountsUsed: number;
  postsThisWeek: number;
  storageBytesUsed: number;
  aiTokensThisMonth: number;
  membrainEntriesUsed: number;
  maxSocialAccounts: number;
  maxPostsPerWeek: number;
  maxStorageBytes: number;
  maxAiTokensPerMonth: number;
  maxMembrainEntries: number;
}

const APPROACHING_THRESHOLD = 0.8;

function metric(
  key: UsageMetric["key"],
  label: string,
  used: number,
  limit: number,
  format: UsageMetric["format"],
): UsageMetric {
  const ratio = limit <= 0 ? (used > 0 ? 1 : 0) : Math.min(used / limit, 1);
  const state: UsageMetric["state"] =
    limit > 0 && used > limit ? "exceeded" : ratio >= APPROACHING_THRESHOLD ? "approaching" : "ok";
  return { key, label, used, limit, ratio, state, format };
}

/** Derives display-ready guardrail metrics. Pure: no I/O, trivially testable. */
export function toUsageMetrics(usage: OrganisationUsage): UsageMetric[] {
  return [
    metric("social_accounts", "Connected channels", usage.socialAccountsUsed, usage.maxSocialAccounts, "count"),
    metric("posts_per_week", "Posts this week", usage.postsThisWeek, usage.maxPostsPerWeek, "count"),
    metric("storage", "Media storage", usage.storageBytesUsed, usage.maxStorageBytes, "bytes"),
    metric("ai_tokens", "AI usage this month", usage.aiTokensThisMonth, usage.maxAiTokensPerMonth, "tokens"),
    metric("membrain_entries", "MemBrain entries", usage.membrainEntriesUsed, usage.maxMembrainEntries, "count"),
  ];
}

export function aggregateUsage(all: OrganisationUsage[]): OrganisationUsage {
  return all.reduce<OrganisationUsage>(
    (acc, u) => ({
      organisationId: "aggregate",
      socialAccountsUsed: acc.socialAccountsUsed + u.socialAccountsUsed,
      postsThisWeek: acc.postsThisWeek + u.postsThisWeek,
      storageBytesUsed: acc.storageBytesUsed + u.storageBytesUsed,
      aiTokensThisMonth: acc.aiTokensThisMonth + u.aiTokensThisMonth,
      membrainEntriesUsed: acc.membrainEntriesUsed + u.membrainEntriesUsed,
      maxSocialAccounts: acc.maxSocialAccounts + u.maxSocialAccounts,
      maxPostsPerWeek: acc.maxPostsPerWeek + u.maxPostsPerWeek,
      maxStorageBytes: acc.maxStorageBytes + u.maxStorageBytes,
      maxAiTokensPerMonth: acc.maxAiTokensPerMonth + u.maxAiTokensPerMonth,
      maxMembrainEntries: acc.maxMembrainEntries + u.maxMembrainEntries,
    }),
    {
      organisationId: "aggregate",
      socialAccountsUsed: 0, postsThisWeek: 0, storageBytesUsed: 0,
      aiTokensThisMonth: 0, membrainEntriesUsed: 0,
      maxSocialAccounts: 0, maxPostsPerWeek: 0, maxStorageBytes: 0,
      maxAiTokensPerMonth: 0, maxMembrainEntries: 0,
    },
  );
}
