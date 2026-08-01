import type { PublishingAnalytics } from "@/core/domain/entities/publishing";

function formatMs(value: number | null): string {
  if (value === null) return "—";
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">{label}</span>
      <span className="text-[15px] font-semibold text-white tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Sourced entirely from PublishingAnalytics (publishing_jobs/
 * publishing_attempts) — never from content_drafts.status — so "Publishing"
 * is never counted as "Approved" here, matching the Sprint 6A requirement
 * that publishing-job data is Mission Control's source of truth for this
 * widget.
 */
export function PublishingEngineWidget({ analytics }: { analytics: PublishingAnalytics }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <h3 className="font-sans font-bold text-[13px] text-white uppercase tracking-wider border-b border-border pb-2.5">
        Publishing Engine
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Queued" value={String(analytics.jobsQueued)} />
        <Stat label="Publishing now" value={String(analytics.jobsProcessing)} />
        <Stat label="Scheduled published" value={String(analytics.scheduledPublications)} />
        <Stat label="Published today" value={String(analytics.publishedToday)} />
        <Stat label="Failed" value={String(analytics.jobsFailedRequiringAttention)} />
        <Stat label="Avg publish time" value={formatMs(analytics.averagePublishTimeMs)} />
        <Stat label="Success rate" value={`${analytics.jobSuccessRate}%`} />
        <Stat label="Retry success rate" value={`${analytics.retrySuccessRate}%`} />
      </div>
    </div>
  );
}
