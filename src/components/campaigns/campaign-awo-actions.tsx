"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getCampaignAwoJobStatusAction, optimiseCampaignWithAwoAction } from "@/server/actions/campaign-awo";
import type { CampaignAwoJobView } from "@/server/queries/campaign-awo-job";

export function CampaignAwoActions({ organisationId, campaignId, totalSlots, optimisedCount, canWrite }: { organisationId: string; campaignId: string; totalSlots: number; optimisedCount: number; canWrite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [job, setJob] = useState<CampaignAwoJobView | null>(null);
  const progressRef = useRef("");
  const complete = totalSlots > 0 && optimisedCount >= totalSlots;
  const active = job?.status === "queued" || job?.status === "processing";

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const next = await getCampaignAwoJobStatusAction(organisationId, campaignId);
        if (cancelled) return;
        setJob(next);
        const key = next ? `${next.id}:${next.status}:${next.completedPosts}:${next.failedPosts}` : "none";
        if (progressRef.current && progressRef.current !== key) router.refresh();
        progressRef.current = key;
      } catch {
        // The command centre's normal 15s refresh is still a fallback if a poll is interrupted.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [campaignId, organisationId, router]);

  const label = pending
    ? "Queuing Awo…"
    : complete
      ? "Awo optimisation complete"
      : job?.status === "processing"
        ? `Awo optimising ${job.completedPosts}/${job.totalPosts}`
        : job?.status === "queued"
          ? `Awo queued · ${job.completedPosts}/${job.totalPosts}`
          : job?.status === "failed"
            ? "Resume Awo optimisation"
            : `Awo optimise all ${totalSlots}`;

  const detail = complete
    ? `${optimisedCount}/${totalSlots} posts have generated captions and hashtags.`
    : active && job
      ? `Background job is running. ${job.completedPosts}/${job.totalPosts} complete${job.failedPosts ? ` · ${job.failedPosts} failed` : ""}. You can leave this page.`
      : job?.status === "failed"
        ? `The previous background run stopped with unfinished posts.${job.lastError ? ` ${job.lastError}` : ""}`
        : "Queues platform-specific captions, hooks, CTAs and discovery hashtags. The work continues even if you leave this page.";

  return <div className="flex flex-col gap-2">
    <Button type="button" disabled={!canWrite || pending || active || totalSlots === 0 || complete} onClick={() => startTransition(async () => {
      const result = await optimiseCampaignWithAwoAction(organisationId, campaignId);
      if (result.status === "success") {
        toast.success(result.message);
        const next = await getCampaignAwoJobStatusAction(organisationId, campaignId).catch(() => null);
        setJob(next);
        router.refresh();
      } else {
        toast.error(result.message, { duration: 10000 });
      }
    })}>
      <Sparkles className="size-4" /> {label}
    </Button>
    <p className="text-[11px] text-muted-foreground">{detail}</p>
  </div>;
}
