import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { classifyPublishingFailure, type FailureClassification } from "@/lib/publishing-failure-classifier";

const SEVERITY_STYLES = {
  high: "border-danger/30 bg-danger-soft text-danger",
  medium: "border-warning/30 bg-warning-soft text-warning-foreground",
  low: "border-border bg-muted text-muted-foreground",
} as const;

const SEVERITY_ICON = {
  high: AlertCircle,
  medium: AlertTriangle,
  low: Info,
} as const;

interface FailureClassificationBadgeProps {
  errorCode: string | null;
  errorMessage?: string | null;
  /** When true, renders a compact single-line badge. When false (default), renders a full card with description and recommended action. */
  compact?: boolean;
}

export function FailureClassificationBadge({ errorCode, errorMessage, compact = false }: FailureClassificationBadgeProps) {
  const classification = classifyPublishingFailure(errorCode);

  if (compact) {
    return <CompactBadge classification={classification} />;
  }

  return <FullCard classification={classification} errorCode={errorCode} errorMessage={errorMessage} />;
}

function CompactBadge({ classification }: { classification: FailureClassification }) {
  const Icon = SEVERITY_ICON[classification.severity];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium",
        SEVERITY_STYLES[classification.severity],
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      {classification.label}
    </span>
  );
}

function FullCard({
  classification,
  errorCode,
  errorMessage,
}: {
  classification: FailureClassification;
  errorCode: string | null;
  errorMessage?: string | null;
}) {
  const Icon = SEVERITY_ICON[classification.severity];

  return (
    <div className={cn("rounded-lg border p-3 text-[12px]", SEVERITY_STYLES[classification.severity])}>
      <div className="flex items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{classification.label}</p>
          <p className="mt-0.5 opacity-80">{classification.description}</p>
          <p className="mt-1.5 font-medium">
            Recommended: <span className="font-normal">{classification.recommendedAction}</span>
          </p>
          {(errorCode ?? errorMessage) ? (
            <p className="mt-2 break-all font-mono opacity-60">
              {errorCode ?? ""}
              {errorCode && errorMessage ? ": " : ""}
              {errorMessage ?? ""}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
