import * as React from "react";
import { cn } from "@/lib/utils";

/** An empty screen is an invitation to act, so it always carries the action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? <div className="text-subtle-foreground [&_svg]:size-6">{icon}</div> : null}
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="max-w-sm text-[13px] text-muted-foreground">{description}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
