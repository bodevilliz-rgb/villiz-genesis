import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ActionState } from "@/server/action-result";
import { cn } from "@/lib/utils";

/** Errors explain what happened and what to do. They never apologise. */
export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (state.status === "idle" || !state.message) return null;

  const isError = state.status === "error";
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]",
        isError ? "border-danger/30 bg-danger-soft text-danger" : "border-positive/30 bg-positive-soft text-positive",
        className,
      )}
    >
      {isError ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{state.message}</span>
    </p>
  );
}
