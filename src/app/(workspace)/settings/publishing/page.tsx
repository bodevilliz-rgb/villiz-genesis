import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { requireContext } from "@/server/container";
import { listStoredBlotatoAccounts } from "@/core/application/use-cases/blotato";
import { mapBlotatoPlatform } from "@/core/domain/entities/blotato";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlatformBadge } from "@/components/publishing/platform-badge";
import { BlotatoConnectionPanel } from "@/components/settings/blotato-connection-panel";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Publishing Settings" };

export default async function PublishingSettingsPage() {
  const context = await requireContext();
  const accounts = await listStoredBlotatoAccounts({ blotatoAccounts: context.blotatoAccounts });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Publishing"
        description="The Blotato connection used to publish content to LinkedIn, Facebook, Instagram, TikTok, and X. Shared across every client account — Blotato has no concept of a Villiz organisation."
      />

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            Verifies the configured API key against Blotato and records every account it reports as connected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BlotatoConnectionPanel canTestConnection={context.actor.isPlatformAdmin} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected accounts</CardTitle>
          <CardDescription>
            Everything Blotato reports for this workspace. Accounts on LinkedIn, Facebook, Instagram, TikTok, or X can
            be used to publish through this app today — the rest are recorded for visibility.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <EmptyState
              icon={<Link2 aria-hidden />}
              title="No accounts recorded yet"
              description="Click Test Connection above to fetch and store every account Blotato has connected."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {accounts.map((account) => {
                const supportedPlatform = mapBlotatoPlatform(account.platform);
                return (
                  <div
                    key={account.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-[13px] font-medium">
                        {account.fullname ?? account.username ?? account.id}
                      </span>
                      {account.username ? (
                        <span className="text-[12px] text-muted-foreground">@{account.username}</span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                      {supportedPlatform ? (
                        <PlatformBadge platform={supportedPlatform} size="sm" />
                      ) : (
                        <Badge tone="muted">{account.platform}</Badge>
                      )}
                      <span>Verified {formatDateTime(account.lastVerifiedAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
