import * as React from "react";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3", className)}>
      <span className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums tracking-tight">{value}</span>
      {detail ? <span className="text-[12px] text-muted-foreground">{detail}</span> : null}
    </div>
  );
}
