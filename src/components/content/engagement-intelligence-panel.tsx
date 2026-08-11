"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  applyEngagementRecommendationAction,
  generateEngagementRecommendationAction,
  recordEngagementCommercialOutcomeAction,
  recordEngagementFeedbackAction,
  refreshEngagementAnalyticsAction,
} from "@/server/actions/awo";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";
import { CAMPAIGN_PLATFORM_LABELS } from "@/core/domain/entities/campaign";
import type { EngagementLearningOverview, EngagementObjectiveType, EngagementRecommendation, EngagementVariant } from "@/core/domain/entities/engagement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EngagementCollectionResult } from "@/core/application/use-cases/engagement/collector";
import { assessEngagementDraftInput } from "@/core/application/use-cases/engagement/draft-input";

const PLATFORMS = Object.keys(CAMPAIGN_PLATFORM_LABELS) as CampaignPlatform[];

const LINKEDIN_ARCHETYPE_LABELS = {
  professional_story: "Professional story",
  lesson_learned: "Lesson learned",
  how_to: "How-to",
  case_study: "Case study",
  point_of_view: "Point of view",
  behind_the_scenes: "Behind the scenes",
} as const;

const LINKEDIN_DIMENSION_LABELS = {
  hook: "Opening hook",
  singleIdea: "Single clear idea",
  personalVoice: "Personal voice",
  credibility: "Credibility",
  scanability: "Scanability",
  conversationCta: "Conversation CTA",
} as const;

function allHashtags(recommendation: EngagementRecommendation): string[] {
  return [...recommendation.hashtags.brand, ...recommendation.hashtags.local,
    ...recommendation.hashtags.service, ...recommendation.hashtags.audience];
}

function displayTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Not collected yet";
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}.`);
  }
}

type PendingApplication = { variant: EngagementVariant; caption: string };

export function EngagementIntelligencePanel({
  organisationId, draftId, currentDraftVersion, initialPlatform, initialRecommendation,
  initialLearningOverview, initialDraftBody, initialDraftHashtags, draftLocked, canWrite,
}: {
  organisationId: string;
  draftId: string;
  currentDraftVersion: number;
  initialPlatform: CampaignPlatform;
  initialRecommendation: EngagementRecommendation | null;
  initialLearningOverview: EngagementLearningOverview;
  initialDraftBody: string;
  initialDraftHashtags: string[];
  draftLocked: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [platform, setPlatform] = useState<CampaignPlatform>(initialRecommendation?.platform ?? initialPlatform);
  const [objective, setObjective] = useState("");
  const [objectiveType, setObjectiveType] = useState<EngagementObjectiveType>(initialRecommendation?.objectiveType ?? "engagement");
  const [recommendation, setRecommendation] = useState(initialRecommendation);
  const [learningOverview, setLearningOverview] = useState(initialLearningOverview);
  const [editedCaption, setEditedCaption] = useState("");
  const [pendingApplication, setPendingApplication] = useState<PendingApplication | null>(null);
  const [effectiveDraftVersion, setEffectiveDraftVersion] = useState(currentDraftVersion);
  const [enquiries, setEnquiries] = useState(initialLearningOverview.latestCommercialOutcome?.enquiries ?? 0);
  const [bookings, setBookings] = useState(initialLearningOverview.latestCommercialOutcome?.bookings ?? 0);
  const [revenuePounds, setRevenuePounds] = useState((initialLearningOverview.latestCommercialOutcome?.revenueMinor ?? 0) / 100);
  const [outcomeNote, setOutcomeNote] = useState(initialLearningOverview.latestCommercialOutcome?.note ?? "");
  const [lastCollectionResult, setLastCollectionResult] = useState<EngagementCollectionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const draftInputAssessment = assessEngagementDraftInput(initialDraftBody);

  function requestRecommendation() {
    startTransition(async () => {
      const result = await generateEngagementRecommendationAction({ organisationId, draftId, platform, objectiveType, objective });
      if (!result.ok) { toast.error(result.error); return; }
      setRecommendation(result.recommendation);
      setLearningOverview(result.learningOverview);
      setEffectiveDraftVersion(result.recommendation.draftVersion);
      setEditedCaption("");
      setPendingApplication(null);
      toast.success("Engagement recommendation generated and recorded.");
    });
  }

  function confirmApplication() {
    if (!recommendation || !pendingApplication) return;
    startTransition(async () => {
      const result = await applyEngagementRecommendationAction({
        organisationId, draftId, recommendationId: recommendation.id,
        variant: pendingApplication.variant, captionSnapshot: pendingApplication.caption,
        hashtagSnapshot: allHashtags(recommendation),
      });
      if (!result.ok) { toast.error(result.error); return; }
      setEffectiveDraftVersion(result.draftVersion);
      setLearningOverview((current) => ({ ...current, latestFeedback: result.feedback }));
      setPendingApplication(null);
      router.refresh();
      toast.success("Caption and hashtags applied to the draft and recorded. Human approval is still required.");
    });
  }

  function dismissRecommendation() {
    if (!recommendation) return;
    startTransition(async () => {
      const result = await recordEngagementFeedbackAction({
        organisationId, draftId, recommendationId: recommendation.id, action: "dismissed",
        variant: null, captionSnapshot: null, hashtagSnapshot: [],
      });
      if (!result.ok) { toast.error(result.error); return; }
      setLearningOverview((current) => ({ ...current, latestFeedback: result.feedback }));
      toast.success("Recommendation dismissed and recorded.");
    });
  }

  function refreshAnalytics() {
    startTransition(async () => {
      const response = await refreshEngagementAnalyticsAction({ organisationId, draftId, platform, objectiveType });
      if (!response.ok) { toast.error(response.error); return; }
      setLearningOverview(response.learningOverview);
      setLastCollectionResult(response.result);
      toast.success(response.result.recorded
        ? `Recorded ${response.result.recorded} new analytics snapshot${response.result.recorded === 1 ? "" : "s"}.`
        : response.result.alreadyRecorded
          ? "Analytics are up to date; no duplicate snapshots were created."
          : "No new published-post metrics were available yet.");
    });
  }

  function recordOutcome() {
    startTransition(async () => {
      const response = await recordEngagementCommercialOutcomeAction({
        organisationId, draftId, platform, objectiveType,
        enquiries, bookings, revenueMinor: Math.round(revenuePounds * 100), currency: "GBP",
        note: outcomeNote || null,
      });
      if (!response.ok) { toast.error(response.error); return; }
      setLearningOverview(response.learningOverview);
      toast.success("Commercial outcome recorded as an append-only snapshot.");
    });
  }

  const hashtags = recommendation ? allHashtags(recommendation) : [];
  const linkedInGuidance = recommendation?.platform === "linkedin"
    ? recommendation.creativeGuidance.linkedinPersonalProfile ?? null
    : null;
  const linkedInAuditRequired = recommendation?.platform === "linkedin"
    && linkedInGuidance?.auditStatus !== "passed";
  const linkedInHashtagPolicyRequired = recommendation?.platform === "linkedin" && hashtags.length > 0;
  const linkedInApplyBlocked = linkedInAuditRequired || linkedInHashtagPolicyRequired;
  const appliedToCurrentVersion = Boolean(
    recommendation && learningOverview.latestFeedback?.recommendationId === recommendation.id
      && learningOverview.latestFeedback.appliedDraftVersion === effectiveDraftVersion,
  );
  const isStale = recommendation ? recommendation.draftVersion !== effectiveDraftVersion && !appliedToCurrentVersion : false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" aria-hidden />AWO Engagement Intelligence</CardTitle>
          {recommendation ? <Badge tone={isStale ? "danger" : appliedToCurrentVersion ? "positive" : "warning"}>
            {isStale ? "Outdated" : appliedToCurrentVersion ? "Applied" : recommendation.dataBasis === "performance_informed" ? "Performance-informed" : "Brand-informed"}
          </Badge> : null}
        </div>
        <CardDescription>Apply evidence-grounded guidance, publish with human approval, then learn from comparable results.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section className="grid gap-3 rounded-md border border-border p-3" aria-label="Learning status">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold">Operator summary</h3>
            <Button type="button" variant="ghost" size="sm" onClick={refreshAnalytics} disabled={!canWrite || pending}>
              <RefreshCw className="size-3.5" aria-hidden /> Refresh analytics
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            <p><span className="block font-medium text-foreground">Selection</span>{appliedToCurrentVersion ? "Applied to current draft" : learningOverview.latestFeedback ? "Recorded, not current" : "Not applied"}</p>
            <p><span className="block font-medium text-foreground">Learning progress</span>{learningOverview.performanceSummary.sampleSize}/{learningOverview.performanceSummary.minimumSampleSize} comparable 7-day posts</p>
            <p><span className="block font-medium text-foreground">Last analytics sync</span>{displayTime(learningOverview.lastAnalyticsSyncAt)}</p>
            <p><span className="block font-medium text-foreground">Next scheduled collection</span>{displayTime(learningOverview.nextScheduledCollectionAt)}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">Checkpoints: 24h {learningOverview.checkpoints.hours24 ? "✓" : "—"} · 72h {learningOverview.checkpoints.hours72 ? "✓" : "—"} · 7d {learningOverview.checkpoints.days7 ? "✓" : "—"}</p>
          {lastCollectionResult?.failed ? <p className="text-[11px] text-danger">Latest refresh could not collect {lastCollectionResult.failed} published post{lastCollectionResult.failed === 1 ? "" : "s"}. Retry once; if it persists, check the Blotato connection.</p> : null}
          {learningOverview.exclusions.length > 0 ? <details className="text-[11px] text-warning"><summary className="cursor-pointer">Why posts are not comparable</summary><ul className="mt-2 grid gap-1 pl-4">{learningOverview.exclusions.map((item) => <li className="list-disc" key={item.code}>{item.count} · {item.label}</li>)}</ul></details> : null}
        </section>

        <div className="grid gap-2">
          {draftInputAssessment.kind === "content_brief" ? <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-[12px] text-warning" role="alert">
            <p className="font-semibold">Generate the full draft first</p>
            <p className="mt-1">{draftInputAssessment.reason}</p>
          </div> : null}
          <Select aria-label="Primary engagement objective" value={objectiveType} onChange={(event) => setObjectiveType(event.target.value as EngagementObjectiveType)} disabled={!canWrite || pending}>
            <option value="awareness">Awareness</option><option value="engagement">Engagement</option><option value="enquiries">Enquiries</option><option value="bookings">Bookings</option>
          </Select>
          <Select aria-label="Engagement platform" value={platform} onChange={(event) => setPlatform(event.target.value as CampaignPlatform)} disabled={!canWrite || pending}>
            {PLATFORMS.map((value) => <option key={value} value={value}>{CAMPAIGN_PLATFORM_LABELS[value]}</option>)}
          </Select>
          <Input aria-label="Engagement objective" value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={300} placeholder="Optional objective, e.g. increase booking enquiries" disabled={!canWrite || pending} />
          <Button type="button" variant="secondary" onClick={requestRecommendation} disabled={!canWrite || pending || draftInputAssessment.kind === "content_brief"}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}{recommendation ? "Generate a new recommendation" : "Generate recommendation"}
          </Button>
          {!canWrite ? <p className="text-[12px] text-muted-foreground">Contributor or Lead access is required to generate a recommendation.</p> : null}
        </div>

        {pendingApplication && recommendation ? <section className="grid gap-3 rounded-md border border-warning/40 bg-warning-soft p-3" aria-label="Confirm recommendation application">
          <h3 className="text-[12px] font-semibold text-warning">Confirm draft replacement</h3>
          <div className="grid gap-2 text-[11px]"><div><p className="font-medium">Current caption</p><p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{initialDraftBody}</p></div><div><p className="font-medium">Replacement caption</p><p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{pendingApplication.caption}</p></div></div>
          <p className="text-[11px] text-muted-foreground">Current hashtags: {initialDraftHashtags.length} · Replacement hashtags: {hashtags.length}. This creates a new draft version; approval remains mandatory.</p>
          <div className="flex gap-2"><Button type="button" size="sm" onClick={confirmApplication} disabled={pending}><Check className="size-3.5" aria-hidden />{recommendation.platform === "linkedin" ? "Apply caption without hashtags" : "Apply caption + hashtags"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setPendingApplication(null)} disabled={pending}>Cancel</Button></div>
        </section> : null}

        {recommendation ? <div className="grid gap-3 border-t border-border pt-4" aria-live="polite">
          {isStale ? <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-[12px] text-danger">This recommendation used draft v{recommendation.draftVersion}; the current draft is v{effectiveDraftVersion}. Generate a new recommendation before applying it.</div> : null}
          {draftLocked ? <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-[12px] text-warning">This draft is locked. Reopen it before applying a recommendation.</div> : null}
          {linkedInHashtagPolicyRequired ? <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-[12px] text-warning">This LinkedIn recommendation contains legacy hashtags. Generate a new recommendation to apply clean, keyword-rich personal-profile copy without hashtags.</div> : null}
          <div className="flex items-center justify-between gap-3"><span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{CAMPAIGN_PLATFORM_LABELS[recommendation.platform]} · Draft v{recommendation.draftVersion}</span><div className="text-right text-[12px]"><div className="font-medium">Brand fit {recommendation.confidence}%</div><div className="text-muted-foreground">Performance confidence {learningOverview.performanceSummary.performanceConfidence === null ? "— not enough data" : `${learningOverview.performanceSummary.performanceConfidence}%`}</div></div></div>

          {linkedInGuidance ? <details className="rounded-md border border-border px-3 py-2 text-[12px]" open>
            <summary className="cursor-pointer font-semibold">LinkedIn personal-profile check · {linkedInAuditRequired ? "Audit required" : `${linkedInGuidance.readinessScore}/100`}</summary>
            {linkedInAuditRequired ? <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-warning">This recommendation predates independent grounding. Generate a new recommendation before applying it.</div> : <div className="mt-3 grid gap-3 text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="muted">Personal profile</Badge><Badge tone="muted">{LINKEDIN_ARCHETYPE_LABELS[linkedInGuidance.postArchetype]}</Badge></div>
              <p className="text-[11px]">Editorial readiness only—not predicted reach or engagement.</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(linkedInGuidance.dimensions).map(([key, score]) => <div key={key} className="rounded border border-border p-2"><span className="block text-[10px] text-subtle-foreground">{LINKEDIN_DIMENSION_LABELS[key as keyof typeof LINKEDIN_DIMENSION_LABELS]}</span><span className="font-medium text-foreground">{score}/5</span></div>)}
              </div>
              <div><p className="font-medium text-foreground">Reader value</p><p>{linkedInGuidance.audiencePromise}</p></div>
              <div><p className="font-medium text-foreground">Credibility anchor</p><p>{linkedInGuidance.credibilityAnchor}</p></div>
              <div><p className="font-medium text-foreground">Conversation prompt</p><p>{linkedInGuidance.conversationPrompt}</p></div>
              <div><p className="font-medium text-foreground">Improve before publishing</p>{linkedInGuidance.improvementActions.length > 0 ? <ul className="mt-1 grid gap-1 pl-4">{linkedInGuidance.improvementActions.map((action) => <li className="list-disc" key={action}>{action}</li>)}</ul> : <p>No blocking editorial changes identified.</p>}</div>
              {linkedInGuidance.auditStatus === "passed" ? <p className="text-[11px] text-positive">Independent grounding audit passed{linkedInGuidance.auditAttempts === 2 ? " after one automatic repair" : ""}.</p> : null}
            </div>}
          </details> : null}

          <details className="rounded-md border border-border px-3 py-2 text-[12px]" open>
            <summary className="cursor-pointer font-semibold">Recommended caption</summary>
            <div className="mt-3 grid gap-2"><p className="whitespace-pre-wrap text-muted-foreground">{recommendation.recommendedCaption}</p><p className="text-[11px] text-muted-foreground">{recommendation.platform === "linkedin" && hashtags.length === 0 ? "LinkedIn personal-profile mode applies clean, keyword-rich copy without hashtags." : `Applying this recommendation also replaces the draft hashtags with the ${hashtags.length} suggested hashtag${hashtags.length === 1 ? "" : "s"} shown below.`}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => copyText(recommendation.recommendedCaption, "Caption")}><Copy className="size-3.5" aria-hidden />Copy</Button><Button type="button" size="sm" onClick={() => setPendingApplication({ variant: "recommended", caption: recommendation.recommendedCaption })} disabled={!canWrite || pending || isStale || draftLocked || linkedInApplyBlocked}><Check className="size-3.5" aria-hidden />{recommendation.platform === "linkedin" ? "Review caption without hashtags" : "Review caption + hashtags"}</Button></div></div>
          </details>

          {recommendation.alternativeCaptions.length > 0 ? <details className="rounded-md border border-border px-3 py-2 text-[12px]"><summary className="cursor-pointer font-semibold">Alternative captions</summary><div className="mt-3 grid gap-3">{recommendation.alternativeCaptions.map((caption, index) => <div key={`${index}-${caption.slice(0, 20)}`} className="grid gap-2"><p className="whitespace-pre-wrap text-muted-foreground">{caption}</p><Button type="button" size="sm" className="justify-self-start" onClick={() => setPendingApplication({ variant: index === 0 ? "alternative_1" : "alternative_2", caption })} disabled={!canWrite || pending || isStale || draftLocked || linkedInApplyBlocked}>Review alternative {index + 1}{recommendation.platform === "linkedin" ? " without hashtags" : " + hashtags"}</Button></div>)}</div></details> : null}

          {recommendation.platform === "linkedin" ? <div className="rounded-md border border-border p-3 text-[11px] text-muted-foreground">To use different LinkedIn wording, edit and save the draft first, then generate a new recommendation so the exact caption receives an independent audit.</div> : <details className="rounded-md border border-border px-3 py-2 text-[12px]"><summary className="cursor-pointer font-semibold">Edit before applying</summary><div className="mt-3 grid gap-2"><Textarea value={editedCaption} onChange={(event) => setEditedCaption(event.target.value)} maxLength={5000} placeholder="Edit the recommendation before applying it" disabled={!canWrite || pending || isStale || draftLocked} /><Button type="button" size="sm" onClick={() => setPendingApplication({ variant: "custom", caption: editedCaption })} disabled={!editedCaption.trim() || !canWrite || pending || isStale || draftLocked}>Preview custom caption</Button></div></details>}

          <details className="rounded-md border border-border px-3 py-2 text-[12px]"><summary className="cursor-pointer font-semibold">Creative guidance, hashtags and reasoning</summary><div className="mt-3 grid gap-4 text-muted-foreground"><div><p className="font-medium text-foreground">Hook</p><p>{recommendation.hook}</p></div><div><p className="font-medium text-foreground">CTA</p><p>{recommendation.cta}</p></div><div><p className="font-medium text-foreground">Creative direction</p><p>{recommendation.creativeGuidance.visualHook} {recommendation.creativeGuidance.formatRecommendation}</p></div><div><p className="font-medium text-foreground">Suggested hashtags</p>{hashtags.length > 0 ? <div className="mt-1 flex flex-wrap gap-1.5">{hashtags.map((hashtag) => <Badge key={hashtag.toLowerCase()} tone="muted">{hashtag}</Badge>)}</div> : <p className="mt-1">None for this LinkedIn personal-profile recommendation.</p>}<p className="mt-2 text-[11px]">{hashtags.length > 0 ? "These replace the draft hashtags when you confirm the recommendation." : "Confirming removes existing draft hashtags so the saved post matches this recommendation exactly."}</p></div><div><p className="font-medium text-foreground">Why AWO recommends this</p><p>{recommendation.rationale}</p></div><p className="text-warning">{recommendation.limitations[0]}</p></div></details>

          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={dismissRecommendation} disabled={!canWrite || pending || isStale}><X className="size-3.5" aria-hidden />Dismiss &amp; record</Button>
          <p className="text-[11px] text-subtle-foreground">Evidence: {recommendation.evidence.length} source {recommendation.evidence.length === 1 ? "record" : "records"}. Human approval remains required.</p>
        </div> : <p className="text-[12px] text-muted-foreground">No recommendation recorded for this draft yet. Results remain advisory and cannot publish content.</p>}

        {learningOverview.latestDraftMetric ? <details className="rounded-md border border-border px-3 py-2 text-[12px]"><summary className="cursor-pointer font-semibold">Record enquiries, bookings and revenue</summary><div className="mt-3 grid gap-2"><div className="grid grid-cols-2 gap-2"><Input type="number" min={0} aria-label="Enquiries" value={enquiries} onChange={(event) => setEnquiries(Number(event.target.value))} /><Input type="number" min={0} aria-label="Bookings" value={bookings} onChange={(event) => setBookings(Number(event.target.value))} /></div><Input type="number" min={0} step="0.01" aria-label="Revenue in pounds" value={revenuePounds} onChange={(event) => setRevenuePounds(Number(event.target.value))} /><Input aria-label="Outcome note" value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} maxLength={500} placeholder="Optional evidence note" /><Button type="button" size="sm" onClick={recordOutcome} disabled={!canWrite || pending || bookings > enquiries}>Record outcome snapshot</Button><p className="text-[11px] text-muted-foreground">Values are append-only snapshots linked to the latest eligible published attempt. Bookings cannot exceed enquiries.</p></div></details> : null}
      </CardContent>
    </Card>
  );
}
