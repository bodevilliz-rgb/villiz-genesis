"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { runPrePublishReviewAction } from "@/server/actions/publish";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import { mapBlotatoPlatform } from "@/core/domain/entities/blotato";
import { PUBLISHING_PLATFORM_LABELS } from "@/core/domain/entities/publishing";
import type { PrePublishReport } from "@/core/application/use-cases/generation/pre-publish-review";
import { toast } from "sonner";

interface PrePublishDialogProps {
  organisationId: string;
  draft: ContentDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmPublish: () => void;
  /** The selected destination channel. Shown in the destination summary row. */
  channel?: BlotatoAccount | null;
  /** Whether the integration is in live-publishing mode. Shown as a mode badge. */
  isLivePublishing?: boolean;
}

export function PrePublishDialog({ organisationId, draft, open, onOpenChange, onConfirmPublish, channel, isLivePublishing = false }: PrePublishDialogProps) {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<PrePublishReport | null>(null);

  useEffect(() => {
    if (open) {
      setLoading(true);
      runPrePublishReviewAction(organisationId, draft)
        .then(setReport)
        .catch(() => toast.error("Failed to run Pre-Publish Review"))
        .finally(() => setLoading(false));
    } else {
      setReport(null);
    }
  }, [open, draft, organisationId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>AI Pre-Publish Review</DialogTitle>
          <DialogDescription>
            Analyzing your draft for brand alignment and best practices before publishing.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 flex flex-col gap-4">
          {/* Destination summary — shown whenever a channel is selected */}
          {channel && (() => {
            const genesis = mapBlotatoPlatform(channel.platform);
            const platformLabel = genesis ? PUBLISHING_PLATFORM_LABELS[genesis] : channel.platform;
            const identity = channel.username ? `@${channel.username}` : channel.fullname ?? channel.id;
            return (
              <div className="flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-2.5 text-sm">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Destination</span>
                  <span className="font-medium">{platformLabel} · {identity}</span>
                </div>
                <span className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${isLivePublishing ? "bg-positive/10 text-positive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                  {isLivePublishing ? "Live" : "Simulation"}
                </span>
              </div>
            );
          })()}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p>Analyzing &quot;{draft.title}&quot;...</p>
            </div>
          ) : report ? (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-4">
                <div className={`flex items-center justify-center size-16 rounded-full border-4 ${report.score >= 80 ? 'border-positive text-positive' : report.score >= 50 ? 'border-amber-500 text-amber-500' : 'border-negative text-negative'}`}>
                  <span className="text-xl font-bold">{report.score}</span>
                </div>
                <div className="flex flex-col">
                  <h3 className="font-semibold text-lg">Overall Score</h3>
                  <p className="text-sm text-muted-foreground">
                    {report.score >= 80 ? 'Excellent! Ready to publish.' : report.score >= 50 ? 'Good, but could be improved.' : 'Needs significant revision before publishing.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  {report.brandVoiceAlignment === 'high' ? <CheckCircle2 className="size-4 text-positive" /> : <AlertTriangle className="size-4 text-amber-500" />}
                  <span>Brand Voice: <span className="capitalize font-medium">{report.brandVoiceAlignment}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  {report.ctaQuality === 'strong' ? <CheckCircle2 className="size-4 text-positive" /> : report.ctaQuality === 'weak' ? <AlertTriangle className="size-4 text-amber-500" /> : <XCircle className="size-4 text-negative" />}
                  <span>Call to Action: <span className="capitalize font-medium">{report.ctaQuality}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  {report.hashtagQuality === 'optimal' ? <CheckCircle2 className="size-4 text-positive" /> : report.hashtagQuality === 'spammy' ? <AlertTriangle className="size-4 text-amber-500" /> : <XCircle className="size-4 text-negative" />}
                  <span>Hashtags: <span className="capitalize font-medium">{report.hashtagQuality}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  {report.missingMedia ? <AlertTriangle className="size-4 text-amber-500" /> : <CheckCircle2 className="size-4 text-positive" />}
                  <span>Media Assets: <span className="font-medium">{report.missingMedia ? 'Missing' : 'Attached'}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  {report.platformOptimisation === 'high' ? <CheckCircle2 className="size-4 text-positive" /> : <AlertTriangle className="size-4 text-amber-500" />}
                  <span>Platform Optimisation: <span className="capitalize font-medium">{report.platformOptimisation}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  {report.accessibility === 'good' ? <CheckCircle2 className="size-4 text-positive" /> : <AlertTriangle className="size-4 text-amber-500" />}
                  <span>Accessibility: <span className="capitalize font-medium">{report.accessibility}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  {report.compliance === 'pass' ? <CheckCircle2 className="size-4 text-positive" /> : <XCircle className="size-4 text-negative" />}
                  <span>Compliance: <span className="capitalize font-medium">{report.compliance}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  {report.readability === 'easy' ? <CheckCircle2 className="size-4 text-positive" /> : <AlertTriangle className="size-4 text-amber-500" />}
                  <span>Readability: <span className="capitalize font-medium">{report.readability}</span></span>
                </div>
              </div>

              {report.recommendations.length > 0 && (
                <div className="flex flex-col gap-2 p-4 bg-muted/30 rounded-lg border border-border">
                  <h4 className="font-medium text-sm">Recommendations</h4>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {report.recommendations.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-negative">Failed to generate report.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>Back to Draft</Button>
          <Button
            variant={report && report.score >= 80 ? "primary" : "secondary"}
            size="lg"
            disabled={loading || !report}
            onClick={onConfirmPublish}
          >
            {report && report.score >= 80 ? "Publish Now" : "Publish Anyway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
