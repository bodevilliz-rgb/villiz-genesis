import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="flex flex-col gap-2">
        {eyebrow ? (
          <p className="text-sm font-semibold text-primary">{eyebrow}</p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{title}</h1>
        {description ? <p className="max-w-2xl text-base leading-7 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
