"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { runPrePublishReviewAction, getPlatformPreflightAction } from "@/server/actions/publish";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import { mapBlotatoPlatform } from "@/core/domain/entities/blotato";
import { PUBLISHING_PLATFORM_LABELS } from "@/core/domain/entities/publishing";
import type { PrePublishReport } from "@/core/application/use-cases/generation/pre-publish-review";
import type { PlatformPreflightResult, CommercialDisclosure } from "@/core/domain/entities/publishing-preflight";
import type { PublishingIntent } from "@/core/domain/entities/publishing";
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
  /**
   * The immutable snapshot of what the operator chose — captured once, at
   * the moment they clicked Publish Now or Schedule. This dialog only ever
   * REVIEWS intent.mode; it never infers, guesses, or defaults it, which is
   * what previously made every review show "Publish Now" regardless of
   * which action was actually being confirmed.
   */
  intent?: PublishingIntent | null;
  /** True while the confirmed action is in flight — disables the confirm button so a second click (or a stale re-invocation) can never double-submit. */
  submitting?: boolean;
}

/**
 * The confirm button's label is derived from intent.mode alone — never
 * guessed, never defaulted to "Publish Now". Exported as a pure function so
 * every mode/state combination is directly unit-testable without mounting
 * the dialog.
 */
export function confirmButtonLabel(
  intent: PublishingIntent | null,
  state: { liveBlocked: boolean; submitting: boolean; score: number | undefined },
): string {
  if (state.liveBlocked) return "Requirements not met";
  if (!intent) return "Review required";
  if (intent.mode === "scheduled") {
    return state.submitting ? "Scheduling…" : "Schedule Post";
  }
  if (state.submitting) return "Publishing…";
  return state.score !== undefined && state.score >= 80 ? "Publish Now" : "Publish Anyway";
}

export function PrePublishDialog({ organisationId, draft, open, onOpenChange, onConfirmPublish, channel, isLivePublishing = false, intent = null, submitting = false }: PrePublishDialogProps) {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<PrePublishReport | null>(null);
  const [preflight, setPreflight] = useState<PlatformPreflightResult | null>(null);

  useEffect(() => {
    if (open) {
      setLoading(true);
      setReport(null);
      setPreflight(null);

      const platform = channel ? mapBlotatoPlatform(channel.platform) : null;

      const fetches: Promise<void>[] = [
        runPrePublishReviewAction(organisationId, draft, platform)
          .then(setReport)
          .catch(() => { toast.error("Failed to run Pre-Publish Review"); }),
      ];

      if (platform) {
        const commercialDisclosure: CommercialDisclosure | null =
          intent && "isYourBrand" in intent
            ? { isYourBrand: intent.isYourBrand ?? null, isBrandedContent: intent.isBrandedContent ?? null }
            : null;
        fetches.push(
          // The intent snapshot's declarations ride along so the dialog's
          // deterministic blocker list reflects exactly what will be
          // submitted — for platforms requiring them (TikTok), an
          // undeclared value surfaces here as a hard blocker.
          getPlatformPreflightAction(organisationId, draft.id, platform, intent?.isAiGenerated ?? null, commercialDisclosure)
            .then(setPreflight)
            .catch(() => {
              // Preflight fetch failure → treat as unknown; don't block the dialog
            }),
        );
      }

      void Promise.all(fetches).finally(() => setLoading(false));
    } else {
      setReport(null);
      setPreflight(null);
    }
  }, [open, draft, organisationId, channel, intent]);

  const liveBlocked = isLivePublishing && preflight !== null && !preflight.ready;
  const publishButtonDisabled = loading || !report || liveBlocked || submitting || !intent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pre-Publish Review</DialogTitle>
          <DialogDescription>
            Checking platform requirements and analyzing your draft before publishing.
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

          {/* TikTok declarations summary — exactly what Genesis will tell TikTok, shown before the operator confirms. Only ever rendered from the intent snapshot, never inferred. */}
          {intent && intent.platform === "tiktok" && (() => {
            const commercialLabel =
              intent.isYourBrand == null || intent.isBrandedContent == null
                ? "Not declared"
                : intent.isYourBrand && intent.isBrandedContent
                  ? "Own brand + branded / paid partnership"
                  : intent.isYourBrand
                    ? "Own brand"
                    : intent.isBrandedContent
                      ? "Branded / paid partnership"
                      : "None";
            return (
              <div className="rounded border border-border bg-muted/30 px-3 py-2.5 text-sm flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">What Genesis will tell TikTok</span>
                <p className="text-[13px]">
                  AI-generated content: <span className="font-medium">{intent.isAiGenerated == null ? "Not declared" : intent.isAiGenerated ? "Yes" : "No"}</span>
                </p>
                <p className="text-[13px]">
                  Commercial content: <span className="font-medium">{commercialLabel}</span>
                </p>
              </div>
            );
          })()}

          {/* Scheduling summary — only ever rendered from intent.mode, never inferred */}
          {intent?.mode === "scheduled" && (
            <div className="flex items-center justify-between rounded border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Scheduled for</span>
                <span className="font-medium">{intent.scheduledForLocalDisplay}</span>
                <span className="text-[11px] text-muted-foreground">
                  {intent.displayTimezone} · {intent.scheduledForUtc} UTC
                </span>
              </div>
              <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-primary/10 text-primary">
                Scheduled
              </span>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p>Analyzing &quot;{draft.title}&quot;...</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Platform requirements — deterministic, server-authoritative */}
              {preflight && (
                <div className={`rounded border px-3 py-3 text-sm ${preflight.ready ? "border-positive/40 bg-positive/5" : liveBlocked ? "border-negative/40 bg-negative/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {preflight.ready
                      ? <CheckCircle2 className="size-4 text-positive shrink-0" />
                      : liveBlocked
                        ? <XCircle className="size-4 text-negative shrink-0" />
                        : <AlertTriangle className="size-4 text-amber-500 shrink-0" />
                    }
                    <span className="font-medium">
                      {preflight.ready
                        ? "Platform requirements met"
                        : liveBlocked
                          ? "Live publishing blocked"
                          : "Platform requirements not met (simulation only)"
                      }
                    </span>
                  </div>
                  {preflight.blockers.length > 0 && (
                    <ul className="ml-6 list-disc text-muted-foreground space-y-0.5 mt-1">
                      {preflight.blockers.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  )}
                  {!preflight.ready && !liveBlocked && (
                    <p className="ml-6 text-[11px] text-muted-foreground mt-1">
                      In simulation mode, this post will still proceed. Switch to live publishing to enforce these requirements.
                    </p>
                  )}
                </div>
              )}

              {/* AI review */}
              {report ? (
                <div className="flex flex-col gap-6">
                  <div className="flex items-center gap-4">
                    <div className={`flex items-center justify-center size-16 rounded-full border-4 ${report.score >= 80 ? 'border-positive text-positive' : report.score >= 50 ? 'border-amber-500 text-amber-500' : 'border-negative text-negative'}`}>
                      <span className="text-xl font-bold">{report.score}</span>
                    </div>
                    <div className="flex flex-col">
                      <h3 className="font-semibold text-lg">AI Score</h3>
                      <p className="text-sm text-muted-foreground">
                        {report.score >= 80
                          ? liveBlocked
                            ? 'Good score, but platform requirements above must be resolved first.'
                            : 'Excellent content quality.'
                          : report.score >= 50
                            ? 'Good, but could be improved.'
                            : 'Needs significant revision before publishing.'
                        }
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
                      {report.hashtagQuality === 'optimal' ? <CheckCircle2 className="size-4 text-positive" /> : report.hashtagQuality === 'spammy' ? <XCircle className="size-4 text-negative" /> : <AlertTriangle className="size-4 text-amber-500" />}
                      <span>Hashtags: <span className="font-medium">{report.hashtagQuality === 'spammy' ? 'Too many' : report.hashtagQuality === 'missing' ? 'Missing' : 'Optimal'}</span></span>
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

                  {report.hashtagPolicyMessage && (
                    <div className="rounded border border-negative/40 bg-negative/5 px-3 py-2.5 text-sm text-negative">
                      {report.hashtagPolicyMessage}
                    </div>
                  )}

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
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>Back to Draft</Button>
          <Button
            variant={report && report.score >= 80 && !liveBlocked ? "primary" : "secondary"}
            size="lg"
            disabled={publishButtonDisabled}
            onClick={onConfirmPublish}
          >
            {confirmButtonLabel(intent, { liveBlocked, submitting, score: report?.score })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
