import * as React from "react";
import { Label } from "./label";
import { cn } from "@/lib/utils";

/**
 * The single form-field wrapper used everywhere. Centralising it guarantees
 * that every input in the platform has a label, an accessible error link and
 * consistent spacing — none of which can then be forgotten per form.
 */
export function Field({
  id,
  label,
  hint,
  errors,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const hasError = Boolean(errors?.length);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>
          {label}
          {required ? <span className="ml-1 text-primary">*</span> : null}
        </Label>
        {hint ? <span className="text-[11px] text-subtle-foreground">{hint}</span> : null}
      </div>
      {children}
      {hasError ? (
        <p id={`${id}-error`} className="text-[12px] text-danger">
          {errors?.[0]}
        </p>
      ) : null}
    </div>
  );
}
