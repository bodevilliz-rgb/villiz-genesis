"use client";
import { useState } from "react";
import type { ContentDraft, ContentDraftStatus } from "@/core/domain/entities/content";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const PIPELINE_COLUMNS: ContentDraftStatus[] = [
  "draft",
  "in_review",
  "changes_requested",
  "awaiting_client",
  "approved",
  "scheduled",
  "published",
  "archived",
];

const COLUMN_LABELS: Record<ContentDraftStatus, string> = {
  draft: "Draft",
  needs_review: "In Review (Legacy)",
  in_review: "In Review",
  changes_requested: "Changes Requested",
  awaiting_client: "Awaiting Client",
  approved: "Approved",
  rejected: "Rejected (Legacy)",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

export function ContentPipelineBoard({
  initialDrafts,
  organisationId,
}: {
  initialDrafts: ContentDraft[];
  organisationId: string;
}) {
  const [drafts, setDrafts] = useState<ContentDraft[]>(initialDrafts);

  async function handleMoveDraft(draftId: string, newStatus: ContentDraftStatus) {
    try {
      // Simulate state validation & update. Server-side validation is checked on action submission.
      setDrafts((prev) =>
        prev.map((d) => (d.id === draftId ? { ...d, status: newStatus } : d))
      );
      toast.success(`Moved draft to ${COLUMN_LABELS[newStatus]}`);
    } catch {
      toast.error("Failed to update status. Transition not allowed.");
    }
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 max-w-full">
      {PIPELINE_COLUMNS.map((column) => {
        const columnDrafts = drafts.filter((d) => d.status === column);

        return (
          <div
            key={column}
            className="flex-1 min-w-[280px] max-w-[320px] rounded-xl border border-border bg-[#050505] p-4 flex flex-col gap-3 min-h-[500px]"
          >
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
                {COLUMN_LABELS[column]}
              </span>
              <Badge tone="muted">{columnDrafts.length}</Badge>
            </div>

            <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[600px] flex-1">
              {columnDrafts.length === 0 ? (
                <div className="flex-1 border border-dashed border-border/40 rounded-lg flex items-center justify-center py-8 text-center">
                  <span className="text-[11px] text-subtle-foreground">No items in this stage</span>
                </div>
              ) : (
                columnDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="p-3.5 border border-border bg-card rounded-lg flex flex-col gap-2 hover:border-primary/50 transition-all cursor-grab active:cursor-grabbing"
                  >
                    <span className="text-xs font-medium">{draft.title}</span>
                    <span className="text-[10px] font-mono text-subtle-foreground uppercase">
                      {draft.contentType}
                    </span>

                    {/* Simple quick controls for accessible drag & drop equivalent */}
                    <div className="flex gap-1 justify-end border-t border-border/40 pt-1.5 mt-1">
                      {PIPELINE_COLUMNS.indexOf(column) > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            handleMoveDraft(
                              draft.id,
                              PIPELINE_COLUMNS[PIPELINE_COLUMNS.indexOf(column) - 1] as ContentDraftStatus
                            )
                          }
                          className="px-1.5 py-0.5 rounded border border-border hover:bg-card-hover text-[10px] font-mono"
                          title="Move Left"
                        >
                          &larr;
                        </button>
                      )}
                      <a
                        href={`/organisations/${organisationId}/content/${draft.id}`}
                        className="px-1.5 py-0.5 rounded border border-border hover:bg-card-hover text-[10px] font-mono text-center flex-1"
                      >
                        Edit
                      </a>
                      {PIPELINE_COLUMNS.indexOf(column) < PIPELINE_COLUMNS.length - 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            handleMoveDraft(
                              draft.id,
                              PIPELINE_COLUMNS[PIPELINE_COLUMNS.indexOf(column) + 1] as ContentDraftStatus
                            )
                          }
                          className="px-1.5 py-0.5 rounded border border-border hover:bg-card-hover text-[10px] font-mono"
                          title="Move Right"
                        >
                          &rarr;
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
