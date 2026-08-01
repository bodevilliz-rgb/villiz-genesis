import Link from "next/link";
import type { PublishingAnalytics } from "@/core/domain/entities/publishing";
import { routes } from "@/lib/routes";

function formatMs(value: number | null): string {
  if (value === null) return "—";
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

/** Null means no resolved data exists yet — never render that as a misleading "0%" (or literal "null%"). */
function formatRate(value: number | null): string {
  return value === null ? "No data yet" : `${value}%`;
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">{label}</span>
      <span className="text-[15px] font-semibold text-white tabular-nums">{value}</span>
    </div>
  );

  if (!href) return content;

  return (
    <Link href={href} className="rounded transition-opacity hover:opacity-80">
      {content}
    </Link>
  );
}

/**
 * Sourced entirely from PublishingAnalytics (publishing_jobs/
 * publishing_attempts) — never from content_drafts.status — so "Publishing"
 * is never counted as "Approved" here, matching the Sprint 6A requirement
 * that publishing-job data is Mission Control's source of truth for this
 * widget.
 */
export function PublishingEngineWidget({
  analytics,
  /** Set only when the actor sees exactly one organisation — a cross-organisation rollup has no single queue page to deep-link into. */
  organisationId,
}: {
  analytics: PublishingAnalytics;
  organisationId: string | null;
}) {
  const queueTabHref = (tab: string) =>
    organisationId ? `${routes.organisations.publishing.index(organisationId)}?tab=${tab}` : undefined;

  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <h3 className="font-sans font-bold text-[13px] text-white uppercase tracking-wider border-b border-border pb-2.5">
        Publishing Engine
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Queued" value={String(analytics.jobsQueued)} href={queueTabHref("queued")} />
        <Stat label="Publishing now" value={String(analytics.jobsProcessing)} href={queueTabHref("publishing")} />
        <Stat label="Scheduled published" value={String(analytics.scheduledPublications)} href={queueTabHref("scheduled")} />
        <Stat label="Published today" value={String(analytics.publishedToday)} href={queueTabHref("published")} />
        <Stat label="Failed" value={String(analytics.jobsFailedRequiringAttention)} href={queueTabHref("failed")} />
        <Stat label="Avg publish time" value={formatMs(analytics.averagePublishTimeMs)} />
        <Stat label="Success rate" value={formatRate(analytics.jobSuccessRate)} />
        <Stat label="Retry success rate" value={formatRate(analytics.retrySuccessRate)} />
      </div>
    </div>
  );
}
