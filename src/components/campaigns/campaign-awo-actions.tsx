"use client";

import { useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { optimiseCampaignWithAwoAction } from "@/server/actions/campaign-awo";

export function CampaignAwoActions({ organisationId, campaignId, totalSlots, optimisedCount, canWrite }: { organisationId: string; campaignId: string; totalSlots: number; optimisedCount: number; canWrite: boolean }) {
  const [pending, startTransition] = useTransition();
  const complete = totalSlots > 0 && optimisedCount >= totalSlots;

  return <div className="flex flex-col gap-2">
    <Button type="button" disabled={!canWrite || pending || totalSlots === 0 || complete} onClick={() => startTransition(async () => {
      const result = await optimiseCampaignWithAwoAction(organisationId, campaignId);
      if (result.status === "success") toast.success(result.message); else toast.error(result.message, { duration: 10000 });
    })}>
      <Sparkles className="size-4" /> {pending ? "Awo optimising…" : complete ? "Awo optimisation complete" : `Awo optimise all ${totalSlots}`}
    </Button>
    <p className="text-[11px] text-muted-foreground">{complete ? `${optimisedCount}/${totalSlots} posts have generated captions and hashtags.` : "Generates platform-specific captions, hooks, CTAs and discovery hashtags from the campaign intelligence context."}</p>
  </div>;
}
