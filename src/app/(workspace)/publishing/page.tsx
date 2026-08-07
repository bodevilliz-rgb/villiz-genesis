import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireContext } from "@/server/container";
import { getPublishingAnalyticsForActor } from "@/core/application/use-cases/publishing";
import { PageHeader } from "@/components/common/page-header";
import { PublishingAnalyticsSummary } from "@/components/publishing/publishing-analytics-summary";
import { PublishingHealthDashboard } from "@/components/publishing/publishing-health-dashboard";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Publishing Command Center" };

export default async function PublishingCommandCenterPage() {
  const context = await requireContext();

  const analytics = await getPublishingAnalyticsForActor(
    { publishing: context.publishing },
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Publishing"
        title="Publishing Command Center"
        description="Cross-account publishing health, metrics, and failure triage. Drill into a client account to manage its queue."
      />

      {/* Platform health dashboard */}
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">
          Platform health
        </h2>
        <PublishingHealthDashboard analytics={analytics} />
      </section>

      {/* Metrics summary */}
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">
          Metrics — all time
        </h2>
        <PublishingAnalyticsSummary analytics={analytics} />
      </section>

      {/* Per-client queue links */}
      <ClientQueueLinks context={context} />
    </div>
  );
}

async function ClientQueueLinks({ context }: { context: Awaited<ReturnType<typeof requireContext>> }) {
  const organisations = await context.organisations.listForActor();
  const active = organisations.filter((o) => o.status === "active");

  if (active.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">
        Client queues
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((org) => (
          <Link
            key={org.id}
            href={routes.organisations.publishing.index(org.id)}
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 text-[13px] font-medium hover:bg-surface transition-colors"
          >
            <span className="truncate">{org.name}</span>
            <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}
