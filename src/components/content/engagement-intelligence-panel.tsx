"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { generateEngagementRecommendationAction, recordEngagementFeedbackAction, refreshEngagementAnalyticsAction } from "@/server/actions/awo";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import { CAMPAIGN_PLATFORM_LABELS } from "@/core/domain/entities/campaign";
import type { EngagementLearningOverview, EngagementObjectiveType, EngagementRecommendation, EngagementVariant } from "@/core/domain/entities/engagement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const PLATFORMS = Object.keys(CAMPAIGN_PLATFORM_LABELS) as CampaignPlatform[];

function allHashtags(recommendation: EngagementRecommendation): string[] {
  return [
    ...recommendation.hashtags.brand,
    ...recommendation.hashtags.local,
    ...recommendation.hashtags.service,
    ...recommendation.hashtags.audience,
  ];
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}.`);
  }
}

export function EngagementIntelligencePanel({
  organisationId,
  draftId,
  currentDraftVersion,
  initialPlatform,
  initialRecommendation,
  initialLearningOverview,
  canWrite,
}: {
  organisationId: string;
  draftId: string;
  currentDraftVersion: number;
  initialPlatform: CampaignPlatform;
  initialRecommendation: EngagementRecommendation | null;
  initialLearningOverview: EngagementLearningOverview;
  canWrite: boolean;
}) {
  const [platform, setPlatform] = useState<CampaignPlatform>(initialRecommendation?.platform ?? initialPlatform);
  const [objective, setObjective] = useState("");
  const [objectiveType, setObjectiveType] = useState<EngagementObjectiveType>(initialRecommendation?.objectiveType ?? "engagement");
  const [recommendation, setRecommendation] = useState(initialRecommendation);
  const [learningOverview, setLearningOverview] = useState(initialLearningOverview);
  const [editedCaption, setEditedCaption] = useState("");
  const [pending, startTransition] = useTransition();

  function requestRecommendation() {
    startTransition(async () => {
      const result = await generateEngagementRecommendationAction({
        organisationId,
        draftId,
        platform,
        objectiveType,
        objective,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRecommendation(result.recommendation);
      setLearningOverview(result.learningOverview);
      setEditedCaption("");
      toast.success("Engagement recommendation generated and recorded.");
    });
  }

  function recordChoice(variant: EngagementVariant, caption: string) {
    if (!recommendation) return;
    startTransition(async () => {
      const result = await recordEngagementFeedbackAction({
        organisationId, draftId, recommendationId: recommendation.id, action: "selected", variant,
        captionSnapshot: caption, hashtagSnapshot: allHashtags(recommendation),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLearningOverview((current) => ({ ...current, latestFeedback: result.feedback }));
      await copyText(caption, "Selected caption");
      toast.success("Choice recorded for the learning loop. Human approval is still required.");
    });
  }

  function dismissRecommendation() {
    if (!recommendation) return;
    startTransition(async () => {
      const result = await recordEngagementFeedbackAction({
        organisationId, draftId, recommendationId: recommendation.id, action: "dismissed",
        variant: null, captionSnapshot: null, hashtagSnapshot: [],
      });
      if (result.ok) {
        setLearningOverview((current) => ({ ...current, latestFeedback: result.feedback }));
        toast.success("Recommendation dismissed and recorded.");
      } else toast.error(result.error);
    });
  }

  function refreshAnalytics() {
    startTransition(async () => {
      const response = await refreshEngagementAnalyticsAction({ organisationId, draftId, platform, objectiveType });
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setLearningOverview(response.learningOverview);
      toast.success(response.result.recorded
        ? `Recorded ${response.result.recorded} new analytics snapshot${response.result.recorded === 1 ? "" : "s"}.`
        : response.result.alreadyRecorded
          ? "Analytics are up to date; no duplicate snapshots were created."
          : "No new published-post metrics were available yet.");
    });
  }

  const hashtags = recommendation ? allHashtags(recommendation) : [];
  const isStale = recommendation ? recommendation.draftVersion !== currentDraftVersion : false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            AWO Engagement Intelligence
          </CardTitle>
          {recommendation ? (
            <Badge tone={isStale ? "danger" : recommendation.dataBasis === "performance_informed" ? "positive" : "warning"}>
              {isStale
                ? "Outdated"
                : recommendation.dataBasis === "performance_informed"
                  ? "Performance-informed"
                  : "Brand-informed"}
            </Badge>
          ) : null}
        </div>
        <CardDescription>Caption, hook, CTA and hashtag guidance grounded in active MemBrain knowledge.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Select
            aria-label="Primary engagement objective"
            value={objectiveType}
            onChange={(event) => setObjectiveType(event.target.value as EngagementObjectiveType)}
            disabled={!canWrite || pending}
          >
            <option value="awareness">Awareness</option>
            <option value="engagement">Engagement</option>
            <option value="enquiries">Enquiries</option>
            <option value="bookings">Bookings</option>
          </Select>
          <Select
            aria-label="Engagement platform"
            value={platform}
            onChange={(event) => setPlatform(event.target.value as CampaignPlatform)}
            disabled={!canWrite || pending}
          >
            {PLATFORMS.map((value) => (
              <option key={value} value={value}>
                {CAMPAIGN_PLATFORM_LABELS[value]}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Engagement objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            maxLength={300}
            placeholder="Optional objective, e.g. increase booking enquiries"
            disabled={!canWrite || pending}
          />
          <Button type="button" variant="secondary" onClick={requestRecommendation} disabled={!canWrite || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {recommendation ? "Generate a new recommendation" : "Generate recommendation"}
          </Button>
          {!canWrite ? (
            <p className="text-[12px] text-muted-foreground">Contributor or Lead access is required to generate a recommendation.</p>
          ) : null}
        </div>

        {recommendation ? (
          <div className="flex flex-col gap-4 border-t border-border pt-4" aria-live="polite">
            {isStale ? (
              <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-[12px] text-danger">
                This recommendation used draft v{recommendation.draftVersion}; the current draft is v{currentDraftVersion}. Generate a new recommendation before relying on it.
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                {CAMPAIGN_PLATFORM_LABELS[recommendation.platform]} · Draft v{recommendation.draftVersion}
              </span>
              <div className="text-right text-[12px]">
                <div className="font-medium text-foreground">Brand fit {recommendation.confidence}%</div>
                <div className="text-muted-foreground">
                  Performance confidence {learningOverview.performanceSummary.performanceConfidence === null ? "— not enough data" : `${learningOverview.performanceSummary.performanceConfidence}%`}
                </div>
              </div>
            </div>

            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold">Recommended caption</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copyText(recommendation.recommendedCaption, "Caption")}
                  aria-label="Copy recommended caption"
                >
                  <Copy className="size-3.5" aria-hidden />
                  Copy
                </Button>
              </div>
              <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-[13px] leading-relaxed">
                {recommendation.recommendedCaption}
              </p>
              <Button type="button" size="sm" onClick={() => recordChoice("recommended", recommendation.recommendedCaption)} disabled={!canWrite || pending || isStale}>
                <Check className="size-3.5" aria-hidden /> Use &amp; record
              </Button>
            </section>

            {recommendation.alternativeCaptions.length > 0 ? (
              <details className="rounded-md border border-border px-3 py-2 text-[12px]">
                <summary className="cursor-pointer font-semibold text-foreground">Alternative captions</summary>
                <div className="mt-3 grid gap-3">
                  {recommendation.alternativeCaptions.map((caption, index) => (
                    <div key={`${index}-${caption.slice(0, 30)}`} className="grid gap-1.5">
                      <p className="whitespace-pre-wrap text-muted-foreground">{caption}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="justify-self-start"
                        onClick={() => copyText(caption, `Alternative ${index + 1}`)}
                      >
                        <Copy className="size-3.5" aria-hidden />
                        Copy alternative {index + 1}
                      </Button>
                      <Button type="button" size="sm" className="justify-self-start"
                        onClick={() => recordChoice(index === 0 ? "alternative_1" : "alternative_2", caption)}
                        disabled={!canWrite || pending || isStale}>
                        <Check className="size-3.5" aria-hidden /> Use &amp; record alternative {index + 1}
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            <section className="grid gap-2 rounded-md border border-border p-3">
              <h3 className="text-[12px] font-semibold">Use an edited variation</h3>
              <Textarea
                aria-label="Edited caption variation"
                value={editedCaption}
                onChange={(event) => setEditedCaption(event.target.value)}
                maxLength={5000}
                placeholder="Paste and edit a recommendation here to record the version you actually intend to use."
                disabled={!canWrite || pending || isStale}
              />
              <Button type="button" size="sm" onClick={() => recordChoice("custom", editedCaption)}
                disabled={!canWrite || pending || isStale || !editedCaption.trim()}>
                <Check className="size-3.5" aria-hidden /> Use edited &amp; record
              </Button>
            </section>

            <dl className="grid gap-3 text-[12px]">
              <div>
                <dt className="font-semibold text-foreground">Hook</dt>
                <dd className="mt-1 text-muted-foreground">{recommendation.hook}</dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">CTA</dt>
                <dd className="mt-1 text-muted-foreground">{recommendation.cta}</dd>
              </div>
            </dl>

            <section className="grid gap-2 rounded-md border border-border p-3">
              <h3 className="text-[12px] font-semibold">Creative guidance</h3>
              <p className="text-[11px] text-muted-foreground">
                {recommendation.creativeGuidance.mediaBasis === "metadata_only" ? "Based on attached-media metadata; no pixel-level visual inspection." : "No attached-media evidence was available."}
              </p>
              <dl className="grid gap-2 text-[12px] text-muted-foreground">
                <div><dt className="font-medium text-foreground">Opening frame</dt><dd>{recommendation.creativeGuidance.visualHook}</dd></div>
                <div><dt className="font-medium text-foreground">Format</dt><dd>{recommendation.creativeGuidance.formatRecommendation}</dd></div>
                <div><dt className="font-medium text-foreground">Share trigger</dt><dd>{recommendation.creativeGuidance.shareTrigger}</dd></div>
                <div><dt className="font-medium text-foreground">Save trigger</dt><dd>{recommendation.creativeGuidance.saveTrigger}</dd></div>
                <div><dt className="font-medium text-foreground">Accessibility</dt><dd>{recommendation.creativeGuidance.accessibilityNote}</dd></div>
              </dl>
            </section>

            <section className="grid gap-2 rounded-md border border-border p-3">
              <h3 className="text-[12px] font-semibold">Recorded selection</h3>
              {learningOverview.latestFeedback ? (
                <div className="grid gap-1 text-[12px] text-muted-foreground">
                  <p>
                    {learningOverview.latestFeedback.action === "selected"
                      ? `Selected ${learningOverview.latestFeedback.variant?.replaceAll("_", " ") ?? "variation"}`
                      : "Recommendation dismissed"}
                    {` · ${new Date(learningOverview.latestFeedback.createdAt).toLocaleString("en-GB")}`}
                  </p>
                  {learningOverview.latestFeedback.captionSnapshot ? (
                    <p className="line-clamp-3 whitespace-pre-wrap rounded-md bg-muted/30 p-2">
                      {learningOverview.latestFeedback.captionSnapshot}
                    </p>
                  ) : null}
                  {learningOverview.latestFeedback.hashtagSnapshot.length > 0 ? (
                    <p>{learningOverview.latestFeedback.hashtagSnapshot.length} hashtags recorded with this choice.</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">No selection has been recorded for this draft.</p>
              )}
            </section>

            <section className="grid gap-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold">Performance learning</h3>
                <Button type="button" variant="ghost" size="sm" onClick={refreshAnalytics} disabled={!canWrite || pending}>
                  <RefreshCw className="size-3.5" aria-hidden /> Refresh
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {learningOverview.performanceSummary.sampleSize}/{learningOverview.performanceSummary.minimumSampleSize} comparable posts · Directional score {learningOverview.performanceSummary.directionalScore ?? "not available"} per 1,000 reach/views.
              </p>
              {learningOverview.accountScope !== "account_scoped" ? (
                <p className="text-[11px] text-warning">
                  {learningOverview.accountScope === "multiple_accounts"
                    ? "Choose a destination account before account-specific learning can be used."
                    : "Connect an active publishing account before account-specific learning can be used."}
                </p>
              ) : null}
              {learningOverview.latestDraftMetric ? (
                <p className="text-[12px] text-muted-foreground">
                  Latest published result: {Object.entries(learningOverview.latestDraftMetric.metrics)
                    .filter(([, value]) => value !== null)
                    .slice(0, 4)
                    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()} ${Number(value).toLocaleString("en-GB")}`)
                    .join(" · ")}.
                </p>
              ) : null}
              {learningOverview.performanceSummary.championVariant ? (
                <p className="text-[12px] text-muted-foreground">
                  Observational candidate: {learningOverview.performanceSummary.championVariant.replaceAll("_", " ")} · Comparison candidate: {learningOverview.performanceSummary.challengerVariant?.replaceAll("_", " ")}. Keep testing; this is not a causal winner.
                </p>
              ) : null}
              <p className="text-[11px] text-subtle-foreground">Directional evidence only; it does not prove that a caption caused the result.</p>
            </section>

            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold">Suggested hashtags</h3>
                {hashtags.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => copyText(hashtags.join(" "), "Hashtags")}
                    aria-label="Copy suggested hashtags"
                  >
                    <Copy className="size-3.5" aria-hidden />
                    Copy
                  </Button>
                ) : null}
              </div>
              {hashtags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {hashtags.map((hashtag) => (
                    <Badge key={hashtag.toLocaleLowerCase()} tone="muted">{hashtag}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">MemBrain did not contain enough evidence for relevant hashtags.</p>
              )}
            </section>

            <section className="grid gap-2">
              <h3 className="text-[12px] font-semibold">Why AWO recommends this</h3>
              <p className="text-[12px] leading-relaxed text-muted-foreground">{recommendation.rationale}</p>
              <ul className="grid gap-1 text-[12px] text-muted-foreground">
                {recommendation.predictedStrengths.map((strength) => (
                  <li key={strength} className="flex gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-positive" aria-hidden />
                    <span>{strength}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-[12px] text-warning">
              {recommendation.limitations[0]}
            </div>

            <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={dismissRecommendation} disabled={!canWrite || pending || isStale}>
              <X className="size-3.5" aria-hidden /> Dismiss &amp; record
            </Button>

            <p className="text-[11px] text-subtle-foreground">
              Evidence: {recommendation.evidence.length} source {recommendation.evidence.length === 1 ? "record" : "records"}. Human approval remains required.
            </p>
            {recommendation.evidence.length > 0 ? (
              <details className="text-[11px] text-subtle-foreground">
                <summary className="cursor-pointer">View evidence</summary>
                <ul className="mt-2 grid gap-1 pl-4">
                  {recommendation.evidence.map((item) => (
                    <li key={`${item.sourceId}-${item.version}`} className="list-disc">
                      {item.title}{item.version ? ` · v${item.version}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No recommendation recorded for this draft yet. Results remain advisory and cannot publish content.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
