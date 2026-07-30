"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { archiveEntryAction } from "@/server/actions/membrain";
import { idleState } from "@/server/action-result";
import { ConfirmSubmit } from "@/components/common/confirm-submit";

/** Archiving removes an entry from AI context without destroying its history. */
export function ArchiveEntryButton({
  organisationId,
  entryId,
  title,
}: {
  organisationId: string;
  entryId: string;
  title: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(archiveEntryAction, idleState);

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      router.refresh();
    }
    if (state.status === "error") toast.error(state.message);
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="entryId" value={entryId} />
      <ConfirmSubmit
        variant="ghost"
        size="sm"
        message={`Archive "${title}"? It stops reaching AI features but stays in the record.`}
      >
        <Archive aria-hidden />
        Archive
      </ConfirmSubmit>
    </form>
  );
}
