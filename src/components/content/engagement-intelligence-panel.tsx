"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { generateEngagementRecommendationAction } from "@/server/actions/awo";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import { CAMPAIGN_PLATFORM_LABELS } from "@/core/domain/entities/campaign";
import type { EngagementRecommendation } from "@/core/domain/entities/engagement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

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
  canWrite,
}: {
  organisationId: string;
  draftId: string;
  currentDraftVersion: number;
  initialPlatform: CampaignPlatform;
  initialRecommendation: EngagementRecommendation | null;
  canWrite: boolean;
}) {
  const [platform, setPlatform] = useState<CampaignPlatform>(initialRecommendation?.platform ?? initialPlatform);
  const [objective, setObjective] = useState("");
  const [recommendation, setRecommendation] = useState(initialRecommendation);
  const [pending, startTransition] = useTransition();

  function requestRecommendation() {
    startTransition(async () => {
      const result = await generateEngagementRecommendationAction({
        organisationId,
        draftId,
        platform,
        objective,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRecommendation(result.recommendation);
      toast.success("Engagement recommendation generated and recorded.");
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
              <span className="text-[12px] font-medium text-foreground">Confidence {recommendation.confidence}%</span>
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
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

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

            <p className="text-[11px] text-subtle-foreground">
              Evidence: {recommendation.evidence.length} active MemBrain {recommendation.evidence.length === 1 ? "entry" : "entries"}. Human approval remains required.
            </p>
            {recommendation.evidence.length > 0 ? (
              <details className="text-[11px] text-subtle-foreground">
                <summary className="cursor-pointer">View MemBrain evidence</summary>
                <ul className="mt-2 grid gap-1 pl-4">
                  {recommendation.evidence.map((item) => (
                    <li key={`${item.sourceId}-${item.version}`} className="list-disc">
                      {item.title} · v{item.version}
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
