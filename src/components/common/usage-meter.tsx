import type { UsageMetric } from "@/core/domain/entities/usage";
import { formatBytes, formatCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function display(value: number, format: UsageMetric["format"]): string {
  if (format === "bytes") return formatBytes(value);
  if (format === "tokens") return formatCompact(value);
  return formatNumber(value);
}

const TONE: Record<UsageMetric["state"], { bar: string; text: string }> = {
  ok: { bar: "bg-primary", text: "text-muted-foreground" },
  approaching: { bar: "bg-warning", text: "text-warning" },
  exceeded: { bar: "bg-danger", text: "text-danger" },
};

/**
 * Guardrail consumption. The bar is deliberately thin and unanimated: an
 * operator scans five of these at a glance and needs the number, not a chart.
 */
export function UsageMeter({ metric, className }: { metric: UsageMetric; className?: string }) {
  const tone = TONE[metric.state];
  const percent = Math.round(metric.ratio * 100);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-muted-foreground">{metric.label}</span>
        <span className={cn("font-mono text-[12px] tabular-nums", tone.text)}>
          {display(metric.used, metric.format)}
          <span className="text-subtle-foreground"> / {display(metric.limit, metric.format)}</span>
        </span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${metric.label}: ${percent}% of limit used`}
      >
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.max(percent, metric.used > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}
