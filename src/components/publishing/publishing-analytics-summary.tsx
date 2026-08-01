import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PublishingAnalytics } from "@/core/domain/entities/publishing";

function formatMs(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

/** Null means no resolved data exists yet — rendered as "No data yet", never a misleading "0%" that looks like a real, poor result. */
function formatRate(value: number | null): string {
  return value === null ? "No data yet" : `${value}%`;
}

function Stat({ label, value, description }: { label: string; value: string; description?: string }) {
  const descriptionId = description ? `publishing-stat-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined;

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-3.5">
        <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-subtle-foreground">
          {label}
          {description ? (
            <span title={description} aria-describedby={descriptionId} className="cursor-help text-muted-foreground">
              <Info aria-hidden="true" className="size-3" />
            </span>
          ) : null}
        </span>
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        {description ? (
          <span id={descriptionId} className="sr-only">
            {description}
          </span>
        ) : null}
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
      <Stat
        label="Avg publish time"
        value={formatMs(analytics.averagePublishTimeMs)}
        description="Average time from a publish attempt starting to completing successfully. Only counts completed attempts."
      />
      <Stat
        label="Job success rate"
        value={formatRate(analytics.jobSuccessRate)}
        description="Of jobs that reached a final state (Published, Failed, or Cancelled), the percentage that ended up Published."
      />
      <Stat
        label="Attempt success rate"
        value={formatRate(analytics.attemptSuccessRate)}
        description="Of publish attempts that finished (succeeded or failed), the percentage that succeeded. Retries count as separate attempts."
      />
      <Stat
        label="Retry success rate"
        value={formatRate(analytics.retrySuccessRate)}
        description="Of retry attempts (attempt 2 and later) that finished, the percentage that succeeded."
      />
      <Stat label="Scheduled published" value={String(analytics.scheduledPublications)} />
      <Stat label="Immediate published" value={String(analytics.immediatePublications)} />
      <Stat label="Successful retries" value={String(analytics.successfulRetries)} />
      <Stat label="Failure rate" value={formatRate(analytics.failureRate)} />
    </div>
  );
}
