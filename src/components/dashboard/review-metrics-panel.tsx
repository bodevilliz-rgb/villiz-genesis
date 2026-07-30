import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/common/stat";
import type { ReviewMetrics } from "@/core/domain/entities/dashboard";
import { formatNumber } from "@/lib/format";

function formatTurnaround(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 6) / 10;
  return `${hours} hr`;
}

export function ReviewMetricsPanel({ metrics }: { metrics: ReviewMetrics }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approvals</CardTitle>
        <CardDescription>Real review-workflow data, across every account.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Awaiting assignment" value={formatNumber(metrics.waitingForAssignment)} />
        <Stat label="Assigned to me" value={formatNumber(metrics.assignedToMe)} />
        <Stat label="Returned for changes" value={formatNumber(metrics.returnedForChanges)} />
        <Stat label="Approved today" value={formatNumber(metrics.approvedToday)} />
        <Stat
          label="Avg. turnaround"
          value={formatTurnaround(metrics.averageTurnaroundMinutes)}
          detail={metrics.averageTurnaroundMinutes === null ? "Nothing approved today" : "Since last submission"}
        />
      </CardContent>
    </Card>
  );
}
