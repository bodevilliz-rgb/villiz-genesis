import { Badge } from "@/components/ui/badge";
import { CONTENT_DRAFT_STATUS_LABELS, type ContentDraftVersion } from "@/core/domain/entities/content";
import { formatDateTime } from "@/lib/format";

/**
 * Read-only: unlike MemBrain, drafts have no restore action in this sprint —
 * the history simply proves what a draft looked like at each status change.
 */
export function DraftVersionTimeline({
  versions,
  currentVersion,
}: {
  versions: ContentDraftVersion[];
  currentVersion: number;
}) {
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
                <Badge tone="muted">{CONTENT_DRAFT_STATUS_LABELS[version.status]}</Badge>
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}
