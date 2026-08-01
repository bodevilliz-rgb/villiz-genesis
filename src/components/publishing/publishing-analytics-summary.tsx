import { Card, CardContent } from "@/components/ui/card";
import type { PublishingAnalytics } from "@/core/domain/entities/publishing";

function formatMs(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-3.5">
        <span className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</span>
        <span className="text-lg font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}

/** Every figure comes straight from PublishingAnalytics — never re-derived here, so the UI can never disagree with the engine's own formulas. */
export function PublishingAnalyticsSummary({ analytics }: { analytics: PublishingAnalytics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Queued" value={String(analytics.jobsQueued)} />
      <Stat label="Publishing now" value={String(analytics.jobsProcessing)} />
      <Stat label="Published today" value={String(analytics.publishedToday)} />
      <Stat label="Failed — needs attention" value={String(analytics.jobsFailedRequiringAttention)} />
      <Stat label="Avg publish time" value={formatMs(analytics.averagePublishTimeMs)} />
      <Stat label="Job success rate" value={`${analytics.jobSuccessRate}%`} />
      <Stat label="Attempt success rate" value={`${analytics.attemptSuccessRate}%`} />
      <Stat label="Retry success rate" value={`${analytics.retrySuccessRate}%`} />
      <Stat label="Scheduled published" value={String(analytics.scheduledPublications)} />
      <Stat label="Immediate published" value={String(analytics.immediatePublications)} />
      <Stat label="Successful retries" value={String(analytics.successfulRetries)} />
      <Stat label="Failure rate" value={`${analytics.failureRate}%`} />
    </div>
  );
}
