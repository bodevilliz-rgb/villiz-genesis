"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { restoreArchivedDraftAction } from "@/server/actions/content";
import { idleState } from "@/server/action-result";
import { CONTENT_DRAFT_TYPE_LABELS, type ContentDraft } from "@/core/domain/entities/content";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

export function ArchivedDraftCard({
  organisationId,
  draft,
  canRestore,
}: {
  organisationId: string;
  draft: ContentDraft;
  canRestore: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(restoreArchivedDraftAction, idleState);

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      router.refresh();
    }
    if (state.status === "error") toast.error(state.message);
  }, [state, router]);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={routes.organisations.content.draft(organisationId, draft.id)}
          className="min-w-0 flex-1 truncate text-[13px] font-medium hover:text-primary"
        >
          {draft.title}
        </Link>
        <Badge tone="muted">Archived</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="muted">{CONTENT_DRAFT_TYPE_LABELS[draft.contentType]}</Badge>
        {draft.scheduledPlatform ? <Badge tone="accent">{draft.scheduledPlatform}</Badge> : null}
        {draft.campaign ? <Badge tone="accent">{draft.campaign.name}</Badge> : null}
      </div>

      <p className="text-[12px] text-subtle-foreground">
        Archived {formatRelative(draft.updatedAt)} · Publishing history preserved
      </p>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Link
          href={routes.organisations.content.draft(organisationId, draft.id)}
          className="text-[12px] font-medium text-primary hover:underline"
        >
          View record
        </Link>
        {canRestore ? (
          <form action={action} className="ml-auto">
            <input type="hidden" name="organisationId" value={organisationId} />
            <input type="hidden" name="id" value={draft.id} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Restoring…">
              <RotateCcw aria-hidden />
              Restore
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </article>
  );
}
