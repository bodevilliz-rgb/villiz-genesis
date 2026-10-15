import type { Metadata } from "next";
import { headers } from "next/headers";
import { KeyRound, Plug } from "lucide-react";
import { requireContext } from "@/server/container";
import { listPublisherConnections } from "@/core/application/use-cases/publisher-connections";
import { resolvePublisherHubClient } from "@/infrastructure/publisher-hub/http-publisher-hub-client";
import { publisherHubConfig } from "@/infrastructure/publisher-hub/publisher-hub-config";
import {
  buildPublisherConnectHref,
  formatTokenExpiry,
  type PublisherConnection,
} from "@/core/domain/entities/publisher-connections";
import { routes } from "@/lib/routes";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConnectedPublisherAccounts } from "@/components/settings/connected-publisher-accounts";

export const metadata: Metadata = { title: "Publisher Connections" };

/**
 * Hub connection state changes out of band (LinkedIn consent, the renewal
 * sweep, disconnects), so this page never serves a cached snapshot.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

export default async function PublisherConnectionsPage({ searchParams }: PageProps) {
  const context = await requireContext();
  const canManage = context.actor.isPlatformAdmin;
  const resolved = await searchParams;
  const client = resolvePublisherHubClient();
  const config = publisherHubConfig();

  let connections: PublisherConnection[] = [];
  let fetchError: string | null = null;
  if (client) {
    try {
      connections = await listPublisherConnections({ client });
    } catch (error) {
      console.error("[genesis] publisher hub connections fetch failed", error);
      fetchError = "The publishing hub is unreachable right now. Try again shortly.";
    }
  }

  // Source for the hub's consent redirect back to this page. Built from the
  // request host when reachable; the hub validates it and otherwise falls back
  // to its configured Genesis return URL, so neither spoofing nor previews
  // break the flow.
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const sourceUrl = host ? `${proto}://${host}${routes.settingsConnections}` : null;

  const initialExpiryLabels = Object.fromEntries(
    connections.map((connection) => [
      connection.id,
      formatTokenExpiry(connection.tokenExpiresAt, new Date()),
    ]),
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Publisher connections"
        description="OAuth accounts the publishing hub can post through. The hub stores every token encrypted-at-rest, renews it automatically ten days before expiry, and stops publishing through any account you disconnect."
      />

      {resolved.connected === "1" ? (
        <Card className="border-positive/40 bg-positive-soft/10">
          <CardContent className="flex items-center gap-3 py-4 text-[13px]">
            <Badge tone="positive">Connected</Badge>
            <span>LinkedIn account connected. The token is stored encrypted on the hub — publishing through the hub is now live for this account.</span>
          </CardContent>
        </Card>
      ) : null}
      {resolved.error && resolved.error.length > 0 ? (
        <Card className="border-danger/40 bg-danger-soft/10">
          <CardContent className="flex items-center gap-3 py-4 text-[13px]">
            <Badge tone="danger">Not connected</Badge>
            <span>Connection did not complete ({resolved.error}). You can try again below.</span>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Connect account</CardTitle>
          <CardDescription>
            One tap: LinkedIn asks for the permission set (read profile + post as you), then returns
            you here with the account already connected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!config ? (
            <EmptyState
              icon={<KeyRound aria-hidden />}
              title="Publishing hub not configured"
              description="This page needs HUB_BASE_URL and HUB_API_KEY (the hub's public TLS origin and its API key). Ask an administrator to set both in the Vercel project environment."
            />
          ) : canManage ? (
            <div className="flex flex-col items-start gap-3">
              <Button asChild>
                <a href={buildPublisherConnectHref(config.baseUrl, sourceUrl)}>
                  <Plug aria-hidden /> Connect account
                </a>
              </Button>
              <p className="text-[12px] text-subtle-foreground">
                Blotato-style warm-up rule: connect only accounts with a real posting history — freshly
                created accounts start cold and read as spam to the platform.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Only platform administrators can connect new publisher accounts.
            </p>
          )}
        </CardContent>
      </Card>

      {/* When the hub isn't configured there are no accounts to list — render
          only the not-configured state above, not an empty accounts card. */}
      {config ? (
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>
              Tombstoned (disconnected) accounts stay listed for history; they can never publish again
              until they are re-connected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fetchError ? (
              <EmptyState
                icon={<Plug aria-hidden />}
                title="Hub unreachable"
                description={fetchError}
              />
            ) : connections.length === 0 ? (
              <EmptyState
                icon={<Plug aria-hidden />}
                title="No publisher accounts connected yet"
                description="Click Connect account above — after consent the account appears here with a green Healthy row."
              />
            ) : (
              <ConnectedPublisherAccounts
                connections={connections}
                canManage={canManage}
                initialExpiryLabels={initialExpiryLabels}
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}