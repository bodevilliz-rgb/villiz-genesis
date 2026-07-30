"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/common/confirm-submit";
import type { MembrainVersion } from "@/core/domain/entities/membrain";
import { importanceLabel } from "@/core/domain/entities/membrain";
import { formatDateTime } from "@/lib/format";
import { restoreVersionAction } from "@/server/actions/membrain";
import { idleState } from "@/server/action-result";

/**
 * History reads newest-first. Restore is available on every prior version and
 * always moves forward — the record of what happened is never rewritten.
 */
export function VersionTimeline({
  organisationId,
  entryId,
  versions,
  currentVersion,
  canRestore,
}: {
  organisationId: string;
  entryId: string;
  versions: MembrainVersion[];
  currentVersion: number;
  canRestore: boolean;
}) {
  const [state, formAction] = useActionState(restoreVersionAction, idleState);

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);

  return (
    <ol className="flex flex-col">
      {versions.map((version, index) => {
        const isCurrent = version.version === currentVersion;
        const isLast = index === versions.length - 1;

        return (
          <li key={version.id} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast ? (
              <span aria-hidden className="absolute left-[7px] top-4 h-full w-px bg-border" />
            ) : null}
            <span
              aria-hidden
              className="relative mt-1.5 size-[15px] shrink-0 rounded-full border-2"
              style={{
                borderColor: isCurrent ? "var(--primary)" : "var(--border-strong)",
                backgroundColor: isCurrent ? "var(--primary)" : "var(--background)",
              }}
            />

            <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] font-medium">v{version.version}</span>
                {isCurrent ? <Badge tone="accent">Current</Badge> : null}
                <Badge tone="muted">{importanceLabel(version.importance)}</Badge>
                <span className="ml-auto text-[11px] text-subtle-foreground">
                  {formatDateTime(version.createdAt)}
                </span>
              </div>

              <p className="text-[13px] font-medium">{version.title}</p>

              <p className="text-[12px] text-muted-foreground">
                {version.changeSummary ?? "No reason recorded."}
                {version.changedBy ? (
                  <span className="text-subtle-foreground">
                    {" "}
                    · {version.changedBy.fullName ?? version.changedBy.email}
                  </span>
                ) : null}
              </p>

              {!isCurrent && canRestore ? (
                <form action={formAction} className="pt-1">
                  <input type="hidden" name="organisationId" value={organisationId} />
                  <input type="hidden" name="entryId" value={entryId} />
                  <input type="hidden" name="version" value={version.version} />
                  <ConfirmSubmit
                    size="sm"
                    variant="secondary"
                    message={`Restore version ${version.version}? This creates a new version — nothing is overwritten.`}
                  >
                    Restore this version
                  </ConfirmSubmit>
                </form>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
