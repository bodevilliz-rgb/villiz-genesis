"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { archiveCampaignAction } from "@/server/actions/campaigns";
import { idleState } from "@/server/action-result";
import { ConfirmSubmit } from "@/components/common/confirm-submit";

/** Lead-only — see canEditOrganisation. Archiving ends a campaign's active life without deleting its record or drafts. */
export function CampaignArchiveButton({
  organisationId,
  campaignId,
  name,
}: {
  organisationId: string;
  campaignId: string;
  name: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(archiveCampaignAction, idleState);

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
      <input type="hidden" name="campaignId" value={campaignId} />
      <ConfirmSubmit
        variant="ghost"
        size="sm"
        message={`Archive "${name}"? Its drafts and record stay exactly as they are — this only ends the campaign's active life.`}
      >
        <Archive aria-hidden />
        Archive
      </ConfirmSubmit>
    </form>
  );
}
