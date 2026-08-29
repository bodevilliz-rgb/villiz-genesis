"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import type { MediaDeletionRequest } from "@/core/domain/entities/media";
import { retryMediaCleanupAction } from "@/server/actions/media";
import { Button } from "@/components/ui/button";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaCleanupStatus({ request }: { request: MediaDeletionRequest }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const retry = () => startTransition(async () => {
    const result = await retryMediaCleanupAction(request.organisationId, request.requestId);
    setMessage(result.message);
    router.refresh();
  });

  return (
    <section aria-label="Media cleanup status" className="rounded-lg border border-border bg-card p-4">
      {request.cleanupState === "pending" ? (
        <>
          <p className="text-[13px] font-medium text-foreground">Media removed from Genesis. Storage cleanup pending.</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Genesis retained the exact Storage paths and can retry safely. No recovered-space claim has been made.
          </p>
          <Button className="mt-3" variant="secondary" size="sm" disabled={isPending} onClick={retry}>
            {isPending ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <RotateCcw className="mr-2 size-3.5" />}
            Retry Storage cleanup
          </Button>
        </>
      ) : (
        <>
          <p className="text-[13px] font-medium text-foreground">Storage cleanup complete.</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Recovered known Storage size: {formatBytes(request.totalBytes)}.</p>
        </>
      )}
      {message ? <p className="mt-2 text-[11px] text-muted-foreground">{message}</p> : null}
    </section>
  );
}
