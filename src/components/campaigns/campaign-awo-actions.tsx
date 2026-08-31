"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getCampaignAwoJobStatusAction, optimiseCampaignWithAwoAction, reoptimiseCampaignDistributionWithAwoAction } from "@/server/actions/campaign-awo";
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
        // The command centre's normal refresh is still a fallback if a poll is interrupted.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [campaignId, organisationId, router]);

  const label = pending
    ? "Queuing Awo…"
    : active && job
      ? `Awo optimising ${job.completedPosts}/${job.totalPosts}`
      : complete
        ? "Awo optimisation complete"
        : job?.status === "failed"
          ? "Resume Awo optimisation"
          : `Awo optimise all ${totalSlots}`;

  const detail = active && job
    ? `Background job is running. ${job.completedPosts}/${job.totalPosts} complete${job.failedPosts ? ` · ${job.failedPosts} failed` : ""}. You can leave this page.`
    : complete
      ? `${optimisedCount}/${totalSlots} posts have generated captions and hashtags. Review them before approval; Distribution Intelligence v2 can deliberately regenerate the copy without changing artwork or schedule.`
      : job?.status === "failed"
        ? `The previous background run stopped with unfinished posts.${job.lastError ? ` ${job.lastError}` : ""}`
        : "Queues platform-specific captions, hooks, CTAs and discovery hashtags. The work continues even if you leave this page.";

  const refreshJob = async () => {
    const next = await getCampaignAwoJobStatusAction(organisationId, campaignId).catch(() => null);
    setJob(next);
    router.refresh();
  };

  return <div className="flex flex-col gap-2">
    <Button type="button" disabled={!canWrite || pending || active || totalSlots === 0 || complete} onClick={() => startTransition(async () => {
      const result = await optimiseCampaignWithAwoAction(organisationId, campaignId);
      if (result.status === "success") {
        toast.success(result.message);
        await refreshJob();
      } else {
        toast.error(result.message, { duration: 10000 });
      }
    })}>
      <Sparkles className="size-4" /> {label}
    </Button>

    {complete ? <Button type="button" variant="secondary" disabled={!canWrite || pending || active || totalSlots === 0} onClick={() => {
      const confirmed = window.confirm(`Re-optimise all ${totalSlots} campaign posts with Distribution Intelligence v2? Generated copy and hashtags will be replaced and returned to Needs Review. Artwork and schedule will not change.`);
      if (!confirmed) return;
      startTransition(async () => {
        const result = await reoptimiseCampaignDistributionWithAwoAction(organisationId, campaignId);
        if (result.status === "success") {
          toast.success(result.message);
          await refreshJob();
        } else {
          toast.error(result.message, { duration: 10000 });
        }
      });
    }}>
      <RefreshCw className="size-4" /> Re-optimise distribution
    </Button> : null}

    <p className="text-[11px] text-muted-foreground">{detail}</p>
  </div>;
}
