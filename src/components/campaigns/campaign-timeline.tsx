import { computeCampaignTimelineProgress } from "@/core/domain/entities/campaign";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A simple visual timeline, not a scheduler — a progress bar between two
 * dates and where "today" sits on it. No calendar, no time slots, no
 * scheduling logic of any kind.
 */
export function CampaignTimeline({ startDate, endDate }: { startDate: string | null; endDate: string | null }) {
  if (!startDate || !endDate) {
    return <p className="text-[13px] text-subtle-foreground">Add a start and end date to see a timeline.</p>;
  }

  const progress = computeCampaignTimelineProgress(startDate, endDate);
  const percent = progress.percentElapsed ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span>{formatDate(startDate)}</span>
        <span className="font-medium text-foreground">
          {!progress.hasStarted ? "Not started" : progress.hasEnded ? "Ended" : `${percent}% elapsed`}
        </span>
        <span>{formatDate(endDate)}</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Campaign timeline: ${percent}% elapsed`}
      >
        <div
          className={cn("h-full rounded-full transition-[width]", progress.hasEnded ? "bg-positive" : "bg-primary")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
