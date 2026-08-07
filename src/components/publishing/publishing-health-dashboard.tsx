import { CheckCircle2, AlertTriangle, XCircle, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PUBLISHING_PLATFORM_LABELS, type PublishingAnalytics } from "@/core/domain/entities/publishing";
import { formatDuration } from "@/lib/format";

function formatPercentage(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

type HealthStatus = "healthy" | "degraded" | "failing" | "no_data";

function resolveHealthStatus(successRate: number | null): HealthStatus {
  if (successRate === null) return "no_data";
  if (successRate >= 90) return "healthy";
  if (successRate >= 70) return "degraded";
  return "failing";
}

const HEALTH_STYLES: Record<HealthStatus, string> = {
  healthy: "text-positive",
  degraded: "text-warning-foreground",
  failing: "text-danger",
  no_data: "text-muted-foreground",
};

const HEALTH_ICON: Record<HealthStatus, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  failing: XCircle,
  no_data: Minus,
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failing: "Failing",
  no_data: "No data",
};

interface PublishingHealthDashboardProps {
  analytics: PublishingAnalytics;
}

export function PublishingHealthDashboard({ analytics }: PublishingHealthDashboardProps) {
  const platforms = analytics.platformBreakdown.filter((p) => p.totalAttempts > 0);
  const overallStatus = resolveHealthStatus(analytics.attemptSuccessRate);
  const OverallIcon = HEALTH_ICON[overallStatus];

  return (
    <div className="flex flex-col gap-4">
      {/* Overall health summary */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <OverallIcon
          aria-hidden
          className={cn("size-5 shrink-0", HEALTH_STYLES[overallStatus])}
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold">
            Platform health:{" "}
            <span className={HEALTH_STYLES[overallStatus]}>{HEALTH_LABEL[overallStatus]}</span>
          </p>
          <p className="text-[12px] text-muted-foreground">
            {analytics.attemptSuccessRate !== null
              ? `${formatPercentage(analytics.attemptSuccessRate)} attempt success rate across all platforms`
              : "No resolved attempts yet"}
          </p>
        </div>
        <div className="flex items-center gap-4 text-right text-[12px] shrink-0">
          <Stat label="Queued" value={String(analytics.jobsQueued)} />
          <Stat label="Active" value={String(analytics.jobsProcessing)} />
          <Stat
            label="Needs attention"
            value={String(analytics.jobsFailedRequiringAttention)}
            highlight={analytics.jobsFailedRequiringAttention > 0}
          />
        </div>
      </div>

      {/* Per-platform breakdown */}
      {platforms.length > 0 ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Platform</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Success</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Failed</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Success rate</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Avg time</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {platforms.map((p) => {
                const status = resolveHealthStatus(p.successRate);
                const Icon = HEALTH_ICON[status];
                return (
                  <tr key={p.platform} className="hover:bg-surface/50 transition-colors">
                    <td className="px-4 py-3 font-medium">{PUBLISHING_PLATFORM_LABELS[p.platform]}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{p.totalAttempts}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-positive">{p.successfulAttempts}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-danger">{p.failedAttempts}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.successRate !== null ? (
                        <span className={HEALTH_STYLES[status]}>{formatPercentage(p.successRate)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {p.averagePublishTimeMs !== null ? formatDuration(p.averagePublishTimeMs) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("flex items-center gap-1", HEALTH_STYLES[status])}>
                        <Icon aria-hidden className="size-3.5" />
                        {HEALTH_LABEL[status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
          No publishing attempts yet. Send a post to see platform health.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className={cn("text-[15px] font-semibold tabular-nums", highlight ? "text-danger" : "text-foreground")}>
        {value}
      </p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  );
}
