"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, Video, Music, FileText, X, Paperclip, Plus, AlertTriangle } from "lucide-react";
import { createDraftAction, updateDraftAction } from "@/server/actions/content";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/common/form-message";
import { CONTENT_DRAFT_TYPE_LABELS, type ContentDraft } from "@/core/domain/entities/content";
import type { MembrainCategory } from "@/core/domain/entities/membrain";
import type { Campaign } from "@/core/domain/entities/campaign";
import type { MediaAsset } from "@/core/domain/entities/media";
import { attachAssetToDraftAction, detachAssetFromDraftAction, detachAssetFromPublishedDraftAction } from "@/server/actions/media";
import { generateCaption, generateHashtags, rewriteContent } from "@/server/actions/awo";
import {
  isDraftBodyEmpty,
  normaliseAiAction,
  isAiActionAvailable,
  rewriteInstructionForAction,
  buildGenerateCaptionArgs,
  buildInterpretationPreview,
  type GenerationGuidedContext,
  type ServiceTreatment,
  type PromotionLevel,
  type CtaMode,
} from "./awo-assist-logic";
import { normalizeHashtags, parseHashtagInput } from "@/core/application/use-cases/content/hashtags";
import { isPublishingPlatform, PUBLISHING_PLATFORM_LABELS, type PublishingPlatform } from "@/core/domain/entities/publishing";
import { getPlatformPublishingPolicy } from "@/core/domain/entities/platform-policy";
import { routes } from "@/lib/routes";
import type { CommercialIntent, CulturalVoiceLevel } from "@/core/domain/entities/market-intelligence";
import type { AwoGenerationAttribution, EngagementVisibilityPlan } from "@/core/domain/entities/engagement";
import { MediaUploadZone } from "@/components/media/media-upload-zone";

export interface GrowthBriefDestination { id: string; platform: PublishingPlatform; label: string }

const AUTOSAVE_DEBOUNCE_MS = 2000;
const SAVED_INDICATOR_MS = 4000;

type SaveState = "idle" | "dirty" | "saving" | "saved";

function AutosaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;

  return (
    <p className="flex items-center gap-1.5 text-[12px] text-subtle-foreground" role="status" aria-live="polite">
      {state === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </>
      ) : state === "saved" ? (
        <>
          <Check className="size-3.5 text-positive" aria-hidden />
          Saved just now
        </>
      ) : (
        "Unsaved changes"
      )}
    </p>
  );
}

/**
 * A document, not a chat window: the title and body dominate the layout, and
 * the metadata that describes the document (type, content pillar, summary)
 * sits below it as a compact secondary row — never above the body, never in
 * a modal.
 *
 * Edit mode autosaves on a debounce. Autosave deliberately skips the success
 * toast and the router.refresh() the explicit Save button triggers — a
 * refresh replays every Server Component data fetch on this page (draft,
 * categories, generation request, and the full generation-readiness bundle —
 * Context Engine, Knowledge/Campaign resolvers, Draft Analyser, Confidence
 * Engine) on every debounce tick, which would make typing feel heavy. The version
 * number in the page header simply lags behind until the next explicit
 * Save or navigation; that's a deliberate tradeoff, not an oversight — see
 * the Sprint 3.1 report's performance considerations.
 */
export function DraftForm({
  organisationId,
  categories,
  campaigns,
  draft,
  locked = false,
  allAssets = [],
  attachedAssets = [],
  signedUrls = {},
  canDetachPublishedMedia = false,
  contentPillars = [],
  growthDestinations = [],
}: {
  organisationId: string;
  categories: MembrainCategory[];
  campaigns: Campaign[];
  draft?: ContentDraft;
  /** True once a draft is approved or rejected — see isContentDraftLocked. Disables every field until a Lead reopens the review. */
  locked?: boolean;
  allAssets?: MediaAsset[];
  attachedAssets?: MediaAsset[];
  signedUrls?: Record<string, string>;
  /** Lead-only: allow detaching assets from a Published draft without reopening the review cycle. */
  canDetachPublishedMedia?: boolean;
  contentPillars?: Array<{ id: string; title: string }>;
  growthDestinations?: GrowthBriefDestination[];
}) {
  const isEdit = Boolean(draft);
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(isEdit ? updateDraftAction : createDraftAction, idleState);

  const formRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const saveState: SaveState = isPending ? "saving" : justSaved ? "saved" : dirty ? "dirty" : "idle";

  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [localAttachedAssets, setLocalAttachedAssets] = useState<MediaAsset[]>(attachedAssets);
  const [isAssetPending, startAssetTransition] = useTransition();
  const [detachPublishedTarget, setDetachPublishedTarget] = useState<MediaAsset | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [draftBody, setDraftBody] = useState<string>(draft?.body ?? "");
  const [aiAction, setAiAction] = useState<string>(
    isDraftBodyEmpty(draft?.body ?? "") ? "generate" : "rewrite",
  );
  const [aiPrompt, setAiPrompt] = useState<string>("");
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [guidedTopic, setGuidedTopic] = useState("");
  const [guidedGoal, setGuidedGoal] = useState("");
  const [guidedServiceTreatment, setGuidedServiceTreatment] = useState<ServiceTreatment | "">("");
  const [guidedSpecificService, setGuidedSpecificService] = useState("");
  const [guidedPromotionLevel, setGuidedPromotionLevel] = useState<PromotionLevel | "">("");
  const [guidedCtaMode, setGuidedCtaMode] = useState<CtaMode | "">("");
  const [guidedCustomCta, setGuidedCustomCta] = useState("");
  const [guidedExtraDirection, setGuidedExtraDirection] = useState("");
  const [hashtags, setHashtags] = useState<string[]>(() => normalizeHashtags(draft?.hashtags ?? []));
  const [hashtagInput, setHashtagInput] = useState("");
  const [hashtagLoading, setHashtagLoading] = useState(false);
  const [hashtagSuggestions, setHashtagSuggestions] = useState<string[] | null>(null);
  const [growthIntent, setGrowthIntent] = useState<CommercialIntent | "">("");
  const [growthVoice, setGrowthVoice] = useState<CulturalVoiceLevel | "">("");
  const [growthDestinationId, setGrowthDestinationId] = useState(growthDestinations[0]?.id ?? "");
  const [growthPillar, setGrowthPillar] = useState("");
  const [visibilityPlan, setVisibilityPlan] = useState<EngagementVisibilityPlan | null>(null);
  const [resolvedGrowthVoice, setResolvedGrowthVoice] = useState<CulturalVoiceLevel | null>(null);
  const [pendingAwoAttribution, setPendingAwoAttribution] = useState<AwoGenerationAttribution | null>(null);
  const [acceptedAwoAttribution, setAcceptedAwoAttribution] = useState<AwoGenerationAttribution | null>(null);

  const effectiveAiAction = normaliseAiAction(aiAction, draftBody);

  const hasGuidedContext = guidedOpen && Boolean(
    growthPillar || guidedTopic || guidedGoal || guidedServiceTreatment || guidedPromotionLevel || guidedCtaMode || guidedExtraDirection,
  );

  function buildGuidedCtx(): GenerationGuidedContext | undefined {
    if (!guidedOpen && !growthPillar) return undefined;
    if (!growthPillar && !guidedTopic && !guidedGoal && !guidedServiceTreatment && !guidedPromotionLevel && !guidedCtaMode && !guidedExtraDirection) return undefined;
    return {
      contentPillar: growthPillar || undefined,
      topic: guidedOpen ? guidedTopic || undefined : undefined,
      goal: guidedOpen ? guidedGoal || undefined : undefined,
      serviceTreatment: guidedOpen ? guidedServiceTreatment || undefined : undefined,
      specificService: guidedOpen && guidedServiceTreatment === "specific_service" && guidedSpecificService ? guidedSpecificService : undefined,
      promotionLevel: guidedOpen ? guidedPromotionLevel || undefined : undefined,
      ctaMode: guidedOpen ? guidedCtaMode || undefined : undefined,
      customCta: guidedOpen && guidedCtaMode === "custom" && guidedCustomCta ? guidedCustomCta : undefined,
      extraDirection: guidedOpen ? guidedExtraDirection || undefined : undefined,
    };
  }

  function commitHashtagInput(raw: string) {
    if (!raw.trim()) return;
    const incoming = normalizeHashtags(parseHashtagInput(raw));
    setHashtags((prev) => normalizeHashtags([...prev, ...incoming]));
    setHashtagInput("");
    // Every other field's autosave fires via the form's onInput bubbling —
    // native to a text input's own "input" event. Hashtag chips are added
    // and removed via button onClick, which never fires "input" and so never
    // bubbled to the form's autosave handler at all: an operator could add
    // hashtags, see them render as chips, and have them silently never
    // reach the server unless they also happened to edit another field.
    // Root cause of "Hashtags: Missing" in Pre-Publish Review despite chips
    // being visibly present on the draft page — proven against production
    // data where content_drafts.hashtags was still [] for an approved draft
    // whose page showed six hashtag chips.
    scheduleAutosave();
  }

  function removeHashtag(token: string) {
    setHashtags((prev) => prev.filter((t) => t.toLowerCase() !== token.toLowerCase()));
    scheduleAutosave();
  }

  async function handleSuggestHashtags() {
    setHashtagLoading(true);
    setHashtagSuggestions(null);
    try {
      // When the draft already carries a destination platform (e.g. from a
      // prior scheduling attempt that was reopened for correction), never
      // suggest more than that platform's verified hashtag limit allows in
      // total — Awo must not hand the operator a set of "optimal"-looking
      // suggestions that immediately violates the same policy Pre-Publish
      // Review and the worker enforce. Unknown platform → existing generic
      // behaviour (5); the destination-specific screens still enforce the
      // real limit once a platform is actually selected there.
      const knownPlatform = isPublishingPlatform(draft?.scheduledPlatform) ? draft.scheduledPlatform : null;
      const policy = knownPlatform ? getPlatformPublishingPolicy(knownPlatform) : null;
      const remaining = policy?.maxHashtags !== undefined ? Math.max(0, policy.maxHashtags - hashtags.length) : 5;

      if (remaining === 0) {
        toast.error(`${knownPlatform ? PUBLISHING_PLATFORM_LABELS[knownPlatform] : "This platform"} allows a maximum of ${policy?.maxHashtags} hashtags — remove one before requesting more suggestions.`);
        return;
      }

      const { hashtags: suggestions } = await generateHashtags(organisationId, draftBody, remaining, knownPlatform ?? "instagram");
      const normalized = normalizeHashtags(suggestions).slice(0, remaining);
      setHashtagSuggestions(normalized.filter((s) => !hashtags.map((h) => h.toLowerCase()).includes(s.toLowerCase())));
    } catch {
      toast.error("Failed to suggest hashtags");
    } finally {
      setHashtagLoading(false);
    }
  }

  function acceptSuggestedHashtag(token: string) {
    const knownPlatform = isPublishingPlatform(draft?.scheduledPlatform) ? draft.scheduledPlatform : null;
    const policy = knownPlatform ? getPlatformPublishingPolicy(knownPlatform) : null;
    if (policy?.maxHashtags !== undefined && hashtags.length >= policy.maxHashtags) {
      toast.error(`${PUBLISHING_PLATFORM_LABELS[knownPlatform!]} allows a maximum of ${policy.maxHashtags} hashtags.`);
      return;
    }
    setHashtags((prev) => normalizeHashtags([...prev, token]));
    setHashtagSuggestions((prev) => prev?.filter((s) => s !== token) ?? null);
    scheduleAutosave();
  }

  async function handleAiAssist() {
    setAiLoading(true);
    try {
      let suggestion = "";

      if (effectiveAiAction === "generate") {
        const destination = growthDestinations.find((item) => item.id === growthDestinationId);
        const [orgId, prompt, platform, intentHints] = buildGenerateCaptionArgs(
          organisationId,
          aiPrompt,
          draft?.title,
          draft?.scheduledPlatform,
          {
            hasCampaign: Boolean(draft?.campaign),
            // Only a real MemBrain content-pillar ENTRY may act as the pillar
            // hint. The previous fallback to draft?.category?.label leaked
            // taxonomy labels ("Audience", "Rules & compliance") into the AI
            // context as if they were the organisation's content pillars.
            contentPillar: growthPillar || null,
            userPromptIsExplicit: aiPrompt.trim().length > 0,
          },
        );
        const selectedPlatform = destination?.platform ?? platform;
        const res = await generateCaption(
          orgId,
          prompt,
          selectedPlatform,
          intentHints,
          buildGuidedCtx(),
          growthIntent || undefined,
          growthVoice || undefined,
          localAttachedAssets.map((asset) => asset.id),
          destination?.id,
        );
        suggestion = res.text;
        setVisibilityPlan(res.visibilityPlan);
        setResolvedGrowthVoice(res.culturalVoiceLevel);
        const hashtagResult = await generateHashtags(organisationId, res.text, 5, isPublishingPlatform(selectedPlatform) ? selectedPlatform : "instagram", res.commercialIntent);
        setHashtagSuggestions(normalizeHashtags(hashtagResult.hashtags));
        setPendingAwoAttribution({ ...res.attribution, suggestedHashtags: normalizeHashtags(hashtagResult.hashtags) });
      } else {
        const instruction = rewriteInstructionForAction(effectiveAiAction);
        const res = await rewriteContent(organisationId, draftBody, instruction);
        suggestion = res.text;
      }

      setAiSuggestion(suggestion);
      toast.success("AI suggestion generated.");
    } catch (e) {
      // Surface the real failure. A generic message hid a provider billing
      // outage behind "Failed to generate AI suggestion" — the operator had
      // no way to distinguish a transient blip from an exhausted account.
      toast.error(e instanceof Error && e.message ? e.message : "Failed to generate AI suggestion");
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  }

  function acceptAiSuggestion() {
    if (!aiSuggestion) return;
    if (!visibilityPlan || visibilityPlan.distributionGate !== "pass" || visibilityPlan.distributionReadinessScore < 95) {
      toast.error(`Awo Audience Distribution Gate blocked this post (${visibilityPlan?.distributionReadinessScore ?? 0}/100). Complete the listed strategy inputs and regenerate.`);
      return;
    }
    setDraftBody(aiSuggestion);
    if (pendingAwoAttribution?.suggestedHashtags.length) {
      setHashtags((current) => normalizeHashtags([...current, ...pendingAwoAttribution.suggestedHashtags]));
    }
    setAcceptedAwoAttribution(pendingAwoAttribution);
    setDirty(true);
    setAiSuggestion(null);
    toast.success("AI suggestion applied to draft.");
  }

  function scheduleAutosave() {
    if (!isEdit || locked) return;
    setDirty(true);
    setJustSaved(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!formRef.current) return;
      autosaveInFlightRef.current = true;
      // Excluded so a reason typed but not yet meant to be submitted never
      // gets attached to an autosave the writer didn't ask for — see the
      // "not sent by autosave" hint on the field itself.
      const formData = new FormData(formRef.current);
      formData.delete("changeSummary");
      formAction(formData);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    if (state.status === "idle") return;

    if (state.status === "success" && state.resourceId) {
      if (!isEdit) {
        const createdDraftId = state.resourceId;
        void (async () => {
          for (const asset of localAttachedAssets) {
            const result = await attachAssetToDraftAction(createdDraftId, asset.id, organisationId);
            if (result.status !== "success") toast.error(`Draft saved, but ${asset.title || asset.fileName} could not be linked.`);
          }
          toast.success(state.message);
          router.push(routes.organisations.content.draft(organisationId, createdDraftId));
        })();
        return;
      }

      setDirty(false);
      if (autosaveInFlightRef.current) {
        setJustSaved(true);
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
        savedTimeoutRef.current = setTimeout(() => setJustSaved(false), SAVED_INDICATOR_MS);
      } else {
        toast.success(state.message);
        router.refresh();
      }
    } else if (state.status === "error") {
      toast.error(state.message);
      setDirty(true);
    }

    autosaveInFlightRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={scheduleAutosave}
      onSubmit={() => {
        // An explicit Save always wins over a pending autosave debounce.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        autosaveInFlightRef.current = false;
      }}
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="organisationId" value={organisationId} />
      {draft ? <input type="hidden" name="id" value={draft.id} /> : null}
      <input type="hidden" name="hashtags" value={JSON.stringify(hashtags)} />
      <input type="hidden" name="awoAttribution" value={acceptedAwoAttribution ? JSON.stringify(acceptedAwoAttribution) : ""} />

      {locked ? (
        <p className="rounded-md border border-border-strong bg-muted px-3 py-2 text-[12px] text-muted-foreground">
          This draft is locked because it has been {draft?.status === "rejected" ? "rejected" : "approved"}. A Lead
          must reopen the review before it can be edited.
        </p>
      ) : null}

      <Field id="title" label="Title" errors={state.fieldErrors?.title} required>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={draft?.title}
          placeholder="Spring promotion — new patient welcome email"
          aria-invalid={Boolean(state.fieldErrors?.title)}
          className="text-base font-medium"
          disabled={locked}
        />
      </Field>

      {isEdit ? <AutosaveIndicator state={saveState} /> : null}

      <Field id="body" label="The draft" hint="Write it as it should appear" errors={state.fieldErrors?.body}>
        <Textarea
          id="body"
          name="body"
          rows={16}
          maxLength={50000}
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          placeholder="Start writing, or use the generation request alongside this document to bring in what MemBrain already knows about this client."
          className="knowledge-body font-mono text-[13px] leading-relaxed"
          aria-invalid={Boolean(state.fieldErrors?.body)}
          disabled={locked}
        />
      </Field>

      {/* AI Assistance Panel */}
      {!locked && (
        <div className="rounded-lg border border-border bg-[#0a0a0a] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-primary">Awo AI Assist</span>
            {aiLoading && <Loader2 className="size-3.5 animate-spin text-primary" />}
          </div>

          {!locked && !isEdit ? (
            <details className="rounded-md border border-border bg-muted/10 p-3">
              <summary className="cursor-pointer text-[12px] font-medium text-foreground">Upload media before generation</summary>
              <div className="mt-3"><MediaUploadZone organisationId={organisationId} onSuccess={() => router.refresh()} /></div>
              <p className="mt-2 text-[11px] text-muted-foreground">After upload, choose the registered asset from the Media Library below before asking Awo to generate.</p>
            </details>
          ) : null}
          <div className="flex flex-wrap gap-2 items-center">
            <Select
              value={effectiveAiAction}
              onChange={(e) => setAiAction(e.target.value)}
              className="max-w-[200px]"
              aria-label="AI Action Selection"
            >
              <option value="generate" disabled={!isAiActionAvailable(draftBody, "generate")}>
                Generate first draft
              </option>
              <option value="rewrite" disabled={!isAiActionAvailable(draftBody, "rewrite")}>
                Rewrite
              </option>
              <option value="shorten" disabled={!isAiActionAvailable(draftBody, "shorten")}>
                Shorten
              </option>
              <option value="expand" disabled={!isAiActionAvailable(draftBody, "expand")}>
                Expand
              </option>
              <option value="change_tone" disabled={!isAiActionAvailable(draftBody, "change_tone")}>
                Change tone
              </option>
              <option
                value="alternative_captions"
                disabled={!isAiActionAvailable(draftBody, "alternative_captions")}
              >
                Create alternative captions
              </option>
              <option value="clarity" disabled={!isAiActionAvailable(draftBody, "clarity")}>
                Improve clarity
              </option>
            </Select>
            <Input
              type="text"
              placeholder="Prompt or context (optional)"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="flex-1 min-w-[200px]"
              aria-label="AI Prompt Context"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleAiAssist}
              disabled={aiLoading}
            >
              Apply AI
            </Button>
          </div>

          {effectiveAiAction === "generate" && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-foreground">Awo Growth Brief</span>
                <span className="text-[10px] text-muted-foreground">Optional · Awo uses safe defaults</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] text-muted-foreground">Goal
                  <Select aria-label="Growth goal" value={growthIntent} onChange={(e) => setGrowthIntent(e.target.value as CommercialIntent | "")} className="mt-1 h-8 text-[12px]">
                    <option value="">Awo recommends</option><option value="convert">Convert</option><option value="engage">Engage</option><option value="build_trust">Build Trust</option>
                  </Select>
                </label>
                <label className="text-[11px] text-muted-foreground">Voice
                  <Select aria-label="Growth voice" value={growthVoice} onChange={(e) => setGrowthVoice(e.target.value as CulturalVoiceLevel | "")} className="mt-1 h-8 text-[12px]">
                    <option value="">Brand Default</option><option value="conversational">Conversational</option><option value="light_naija">Light Naija — authorised contexts only</option>
                  </Select>
                </label>
                <label className="text-[11px] text-muted-foreground">Platform / destination
                  <Select aria-label="Growth destination" value={growthDestinationId} onChange={(e) => setGrowthDestinationId(e.target.value)} className="mt-1 h-8 text-[12px]" disabled={growthDestinations.length === 0}>
                    {growthDestinations.length === 0 ? <option value="">No connected destination</option> : growthDestinations.map((item) => <option key={item.id} value={item.id}>{PUBLISHING_PLATFORM_LABELS[item.platform]} · {item.label}</option>)}
                  </Select>
                </label>
                <label className="text-[11px] text-muted-foreground">Content pillar
                  <Select aria-label="Growth content pillar" value={growthPillar} onChange={(e) => setGrowthPillar(e.target.value)} className="mt-1 h-8 text-[12px]">
                    <option value="">Awo chooses from MemBrain</option>{contentPillars.map((pillar) => <option key={pillar.id} value={pillar.title}>{pillar.title}</option>)}
                  </Select>
                </label>
              </div>
              {growthVoice === "light_naija" && resolvedGrowthVoice && resolvedGrowthVoice !== "light_naija" ? <p role="status" className="mt-2 text-[11px] text-warning">Light Naija was not authorised by this client’s Market Intelligence. Awo used the safe brand voice.</p> : null}
            </div>
          )}

          {effectiveAiAction === "generate" && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setGuidedOpen((v) => !v)}
              >
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${guidedOpen ? "rotate-90" : ""}`}
                />
                Guided context {hasGuidedContext ? "· active" : "· optional"}
              </button>

              {guidedOpen && (
                <div className="mt-2 rounded border border-border bg-muted/30 p-3 flex flex-col gap-3">
                  {hasGuidedContext && (
                    <p className="text-[11px] text-muted-foreground font-mono">
                      {buildInterpretationPreview(Boolean(draft?.campaign), buildGuidedCtx())}
                    </p>
                  )}

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-muted-foreground">Topic</label>
                      <Input
                        type="text"
                        placeholder="e.g. Welcome to August"
                        value={guidedTopic}
                        onChange={(e) => setGuidedTopic(e.target.value)}
                        className="text-[12px] h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-muted-foreground">Goal</label>
                      <Input
                        type="text"
                        placeholder="e.g. Build community connection"
                        value={guidedGoal}
                        onChange={(e) => setGuidedGoal(e.target.value)}
                        className="text-[12px] h-8"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-muted-foreground">Service treatment</label>
                      <Select
                        value={guidedServiceTreatment}
                        onChange={(e) => setGuidedServiceTreatment(e.target.value as ServiceTreatment | "")}
                        className="text-[12px] h-8"
                      >
                        <option value="">Auto</option>
                        <option value="brand_overview">Brand overview</option>
                        <option value="specific_service">Specific service</option>
                        <option value="no_service_mention">No service mention</option>
                      </Select>
                    </div>
                    {guidedServiceTreatment === "specific_service" && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">Specific service</label>
                        <Input
                          type="text"
                          placeholder="e.g. Bridal makeup"
                          value={guidedSpecificService}
                          onChange={(e) => setGuidedSpecificService(e.target.value)}
                          className="text-[12px] h-8"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-muted-foreground">Promotion level</label>
                      <Select
                        value={guidedPromotionLevel}
                        onChange={(e) => setGuidedPromotionLevel(e.target.value as PromotionLevel | "")}
                        className="text-[12px] h-8"
                      >
                        <option value="">Auto</option>
                        <option value="none">None</option>
                        <option value="soft">Soft</option>
                        <option value="promotional">Promotional</option>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-muted-foreground">CTA</label>
                      <Select
                        value={guidedCtaMode}
                        onChange={(e) => setGuidedCtaMode(e.target.value as CtaMode | "")}
                        className="text-[12px] h-8"
                      >
                        <option value="">Auto</option>
                        <option value="auto">Auto</option>
                        <option value="soft_enquiry">Soft enquiry</option>
                        <option value="book">Booking</option>
                        <option value="custom">Custom</option>
                        <option value="none">None</option>
                      </Select>
                    </div>
                  </div>

                  {guidedCtaMode === "custom" && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-muted-foreground">Custom CTA text</label>
                      <Input
                        type="text"
                        placeholder="e.g. Sign up for our newsletter"
                        value={guidedCustomCta}
                        onChange={(e) => setGuidedCustomCta(e.target.value)}
                        className="text-[12px] h-8"
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Extra direction</label>
                    <Input
                      type="text"
                      placeholder="Any additional guidance for Awo"
                      value={guidedExtraDirection}
                      onChange={(e) => setGuidedExtraDirection(e.target.value)}
                      className="text-[12px] h-8"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {aiSuggestion && (
            <div className="rounded border border-primary/20 bg-primary/5 p-3 flex flex-col gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">AI Suggestion:</span>
              <p className="text-[13px] whitespace-pre-wrap font-mono text-muted-foreground">{aiSuggestion}</p>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={acceptAiSuggestion} disabled={!visibilityPlan || visibilityPlan.distributionGate !== "pass" || visibilityPlan.distributionReadinessScore < 95}>
                  {visibilityPlan?.distributionGate === "blocked" ? "Blocked by Distribution Gate" : "Accept Suggestion"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAiSuggestion(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}
          {visibilityPlan && aiSuggestion && (
            <details className="rounded border border-border bg-muted/20 p-3 text-[11px]" open>
              <summary className="cursor-pointer font-medium text-foreground">Awo Growth Decision · {visibilityPlan.visibilityEvidenceLevel.replaceAll("_", " ")}</summary>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2 text-muted-foreground">
                <div className="sm:col-span-2"><dt className="text-foreground">Audience Distribution Gate</dt><dd className={visibilityPlan.distributionGate === "pass" ? "text-positive" : "text-warning"}>{(visibilityPlan.distributionGate ?? "blocked").toUpperCase()} · {visibilityPlan.distributionReadinessScore ?? 0}/100 · minimum 95</dd></div>
                {(visibilityPlan.distributionBlockers ?? ["This earlier recommendation predates the audience distribution gate. Regenerate it before acceptance."]).length > 0 && <div className="sm:col-span-2"><dt className="text-foreground">Required before acceptance</dt><dd><ul className="list-disc pl-4">{(visibilityPlan.distributionBlockers ?? ["This earlier recommendation predates the audience distribution gate. Regenerate it before acceptance."]).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></dd></div>}
                <div><dt className="text-foreground">Goal</dt><dd>{visibilityPlan.goal?.replaceAll("_", " ") ?? "Not recorded on this earlier decision"}</dd></div>
                <div><dt className="text-foreground">Why this goal</dt><dd>{visibilityPlan.goalRationale ?? "Not recorded"}</dd></div>
                <div><dt className="text-foreground">Content job</dt><dd>{visibilityPlan.contentJob ?? "Not recorded"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Audience</dt><dd>{visibilityPlan.targetAudience}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">ACOR locality</dt><dd>{visibilityPlan.targetLocalities?.join(", ") || "None verified"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Platform strategy</dt><dd>{visibilityPlan.platformStrategy ?? "Not recorded on this earlier decision"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Discovery roles</dt><dd>{visibilityPlan.discoveryRoles?.join(", ") || "None configured"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Media observation</dt><dd>{visibilityPlan.mediaObservation ?? "Not recorded on this earlier decision"}</dd></div>
                <div><dt className="text-foreground">Pillar</dt><dd>{visibilityPlan.contentPillar ?? "Not recorded"}</dd></div>
                <div><dt className="text-foreground">Pillar rationale</dt><dd>{visibilityPlan.contentPillarRationale ?? "Not recorded"}</dd></div>
                <div><dt className="text-foreground">Format</dt><dd>{visibilityPlan.contentFormat.replaceAll("_", " ")}{visibilityPlan.formatRationale ? ` — ${visibilityPlan.formatRationale}` : ""}</dd></div>
                <div><dt className="text-foreground">Attention</dt><dd>{visibilityPlan.attentionMechanism ?? "Not recorded"}</dd></div>
                <div><dt className="text-foreground">Hook family</dt><dd>{visibilityPlan.hookStrategy.replaceAll("_", " ")}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Hook</dt><dd>{visibilityPlan.actualHook ?? "Not recorded"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Discovery</dt><dd>{visibilityPlan.discoveryStrategy}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">CTA</dt><dd>{visibilityPlan.ctaStrategy}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Hashtags</dt><dd>{hashtagSuggestions?.length ? hashtagSuggestions.map((tag) => `#${tag}`).join(" ") : "No supported suggestions returned."}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Supporting distribution</dt><dd>{visibilityPlan.supportingDistributionActions.join(" ")}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Measurement</dt><dd>{visibilityPlan.measurementPlan}</dd></div>
                <div className="sm:col-span-2"><dt className="text-foreground">Evidence and rationale</dt><dd>{visibilityPlan.visibilityEvidenceLevel.replaceAll("_", " ")}{typeof visibilityPlan.confidence === "number" ? ` · confidence ${visibilityPlan.confidence}/100` : ""}{visibilityPlan.evidenceSources?.length ? ` · ${visibilityPlan.evidenceSources.join(", ")}` : ""}. {visibilityPlan.rationale}</dd></div>
              </dl>
            </details>
          )}
        </div>
      )}

      {/* Hashtags */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-foreground">Hashtags</span>
          {!locked && (
            <button
              type="button"
              onClick={handleSuggestHashtags}
              disabled={hashtagLoading || !draftBody.trim()}
              className="text-[11px] text-primary hover:text-primary/80 disabled:text-muted-foreground disabled:cursor-not-allowed flex items-center gap-1"
            >
              {hashtagLoading ? <Loader2 className="size-3 animate-spin" /> : null}
              Suggest hashtags
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          Add hashtags separately. Genesis will format them when publishing.
        </p>

        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {hashtags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium text-foreground border border-border"
              >
                #{tag}
                {!locked && (
                  <button
                    type="button"
                    onClick={() => removeHashtag(tag)}
                    className="text-muted-foreground hover:text-foreground ml-0.5"
                    aria-label={`Remove #${tag}`}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {hashtagSuggestions && hashtagSuggestions.length > 0 && (
          <div className="rounded border border-primary/20 bg-primary/5 p-2.5 flex flex-col gap-1.5">
            <span className="text-[11px] text-muted-foreground">Awo suggests — click to add:</span>
            <div className="flex flex-wrap gap-1.5">
              {hashtagSuggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => acceptSuggestedHashtag(tag)}
                  className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[12px] font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {!locked && (
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="#Hashtag1 #Hashtag2 or Hashtag1, Hashtag2"
              value={hashtagInput}
              onChange={(e) => setHashtagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitHashtagInput(hashtagInput);
                }
              }}
              className="flex-1 text-[12px] h-8"
              aria-label="Add hashtags"
            />
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-3 text-[12px]"
              onClick={() => commitHashtagInput(hashtagInput)}
              disabled={!hashtagInput.trim()}
            >
              Add
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contentType" label="Content type" errors={state.fieldErrors?.contentType}>
          <Select id="contentType" name="contentType" defaultValue={draft?.contentType ?? "social_post"} disabled={locked}>
            {Object.entries(CONTENT_DRAFT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        {/* This select stores content_drafts.category_id → membrain_categories:
            it files the draft under a MemBrain TAXONOMY category. It was
            previously labelled "Content pillar", which made the taxonomy list
            (Brand description, Brand voice, Audience, …) masquerade as the
            organisation's pillar knowledge. The real pillar control is the
            entry-backed "Content pillar" in the Awo Growth Brief above. */}
        <Field
          id="categoryId"
          label="MemBrain category"
          hint="Files this draft in MemBrain's taxonomy. Generation pillars are chosen in the Awo Growth Brief."
          errors={state.fieldErrors?.categoryId}
        >
          <Select id="categoryId" name="categoryId" defaultValue={draft?.category?.id ?? ""} disabled={locked}>
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="campaignId" label="Campaign" hint="Optional" errors={state.fieldErrors?.campaignId}>
          <Select id="campaignId" name="campaignId" defaultValue={draft?.campaign?.id ?? ""} disabled={locked}>
            <option value="">No campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="summary"
          label="One-line summary"
          hint="Optional"
          errors={state.fieldErrors?.summary}
          className="sm:col-span-2"
        >
          <Input id="summary" name="summary" maxLength={500} defaultValue={draft?.summary ?? ""} disabled={locked} />
        </Field>
      </div>

      {(
        <div className="border-t border-border pt-6 mt-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h4 className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
              <Paperclip className="size-4 text-primary" /> Attached Media & Brand Assets
            </h4>
            {!locked && (
              <Button type="button" onClick={() => setShowAssetModal(true)} variant="ghost" className="h-7 py-1 px-2.5 text-[11px]">
                <Plus className="size-3.5 mr-1" /> Link asset
              </Button>
            )}
          </div>

          {localAttachedAssets.length === 0 ? (
            <p className="text-[12px] text-muted-foreground italic">No brand or media assets linked to this draft yet.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {localAttachedAssets.map((asset) => {
                const sUrl = signedUrls[asset.storagePath];
                return (
                  <div key={asset.id} className="flex items-center justify-between p-2 rounded-md border border-border bg-muted/20">
                    <div className="flex items-center gap-2.5 truncate">
                      {asset.mimeType.startsWith("image/") && sUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={sUrl} alt="" className="size-8 rounded object-cover border border-border" />
                      ) : (
                        <div className="size-8 rounded border border-border bg-muted flex items-center justify-center">
                          {asset.mimeType.startsWith("video/") ? <Video className="size-4 text-muted-foreground" /> :
                           asset.mimeType.startsWith("audio/") ? <Music className="size-4 text-muted-foreground" /> :
                           <FileText className="size-4 text-muted-foreground" />}
                        </div>
                      )}
                      <div className="flex flex-col truncate">
                        <span className="text-[12px] font-medium text-foreground truncate">{asset.title || asset.fileName}</span>
                        <span className="text-[10px] text-muted-foreground capitalize">{asset.mimeType.split("/")[1]}</span>
                      </div>
                    </div>
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => {
                          startAssetTransition(async () => {
                            if (!draft) {
                              setLocalAttachedAssets((current) => current.filter((item) => item.id !== asset.id));
                              return;
                            }
                            const result = await detachAssetFromDraftAction(draft.id, asset.id, organisationId);
                            if (result.status === "success") {
                              toast.success(result.message);
                              setLocalAttachedAssets(localAttachedAssets.filter(a => a.id !== asset.id));
                            } else {
                              toast.error(result.message);
                            }
                          });
                        }}
                        className="text-muted-foreground hover:text-negative p-1 rounded"
                        disabled={isAssetPending}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                    {locked && draft?.status === "published" && canDetachPublishedMedia && (
                      <button
                        type="button"
                        onClick={() => setDetachPublishedTarget(asset)}
                        className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/60 whitespace-nowrap"
                        disabled={isAssetPending}
                      >
                        Detach
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showAssetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl max-h-[70vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h4 className="text-md font-semibold text-foreground">Link Brand Asset</h4>
              <button type="button" onClick={() => setShowAssetModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 flex flex-col gap-2">
              {allAssets
                .filter(asset => !localAttachedAssets.some(a => a.id === asset.id))
                .map(asset => (
                  <div key={asset.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/40 border border-transparent hover:border-border">
                    <div className="flex items-center gap-3">
                      {asset.mimeType.startsWith("image/") && signedUrls[asset.storagePath] ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={signedUrls[asset.storagePath]} alt="" className="size-8 rounded object-cover border border-border" />
                      ) : (
                        <div className="size-8 rounded border border-border bg-muted flex items-center justify-center">
                          {asset.mimeType.startsWith("video/") ? <Video className="size-4 text-muted-foreground" /> :
                           asset.mimeType.startsWith("audio/") ? <Music className="size-4 text-muted-foreground" /> :
                           <FileText className="size-4 text-muted-foreground" />}
                        </div>
                      )}
                      <div>
                        <p className="text-[12px] font-medium text-foreground truncate max-w-[200px]">{asset.title || asset.fileName}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">{asset.mimeType.split("/")[1]}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={() => {
                        startAssetTransition(async () => {
                          if (!draft) {
                            setLocalAttachedAssets((current) => [...current, asset]);
                            setShowAssetModal(false);
                            return;
                          }
                          const result = await attachAssetToDraftAction(draft.id, asset.id, organisationId);
                          if (result.status === "success") {
                            toast.success(result.message);
                            setLocalAttachedAssets([...localAttachedAssets, asset]);
                            setShowAssetModal(false);
                          } else {
                            toast.error(result.message);
                          }
                        });
                      }}
                      variant="ghost"
                      className="text-primary text-[11px] font-medium py-1 px-2.5 h-auto"
                      disabled={isAssetPending}
                    >
                      Link
                    </Button>
                  </div>
                ))}

              {allAssets.filter(asset => !localAttachedAssets.some(a => a.id === asset.id)).length === 0 && (
                <p className="text-center text-[12px] text-muted-foreground py-8">All available assets have been linked to this draft.</p>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
              <Button type="button" onClick={() => setShowAssetModal(false)} variant="primary">Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {detachPublishedTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-5">
              <AlertTriangle className="size-5 text-warning mt-0.5 shrink-0" />
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Detach asset from published draft?</h4>
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  This draft has already been published. Detaching this asset only removes the Media Library
                  relationship from this Genesis draft. It will not remove or alter the post already published
                  on the social platform.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-3 text-[12px]"
                onClick={() => setDetachPublishedTarget(null)}
                disabled={isAssetPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-3 text-[12px] text-negative hover:text-negative"
                disabled={isAssetPending}
                onClick={() => {
                  startAssetTransition(async () => {
                    if (!draft || !detachPublishedTarget) return;
                    const result = await detachAssetFromPublishedDraftAction(
                      organisationId,
                      draft.id,
                      detachPublishedTarget.id,
                    );
                    if (result.status === "success") {
                      toast.success(result.message);
                      setLocalAttachedAssets((prev) => prev.filter((a) => a.id !== detachPublishedTarget.id));
                    } else {
                      toast.error(result.message);
                    }
                    setDetachPublishedTarget(null);
                  });
                }}
              >
                Detach from draft
              </Button>
            </div>
          </div>
        </div>
      )}

      {isEdit ? (
        <Field
          id="changeSummary"
          label="What changed?"
          hint="Optional · recorded permanently against this version · not sent by autosave"
          errors={state.fieldErrors?.changeSummary}
        >
          <Input
            id="changeSummary"
            name="changeSummary"
            maxLength={280}
            placeholder="Tightened the CTA after the client call"
            disabled={locked}
          />
        </Field>
      ) : null}

      <FormMessage state={state} />

      <div className="flex items-center gap-3">
        {locked ? (
          // A plain disabled Button, not SubmitButton — SubmitButton spreads
          // its own props after `disabled={pending}`, so passing `disabled`
          // through it here would fight (and sometimes lose to) that pending
          // state instead of cleanly overriding it.
          <Button type="button" disabled>
            {isEdit ? "Save" : "Create draft"}
          </Button>
        ) : (
          <SubmitButton pendingLabel={isEdit ? "Saving…" : "Creating…"}>
            {isEdit ? "Save" : "Create draft"}
          </SubmitButton>
        )}
        {isEdit ? (
          <Button asChild variant="ghost">
            <a href={routes.organisations.content.index(organisationId)}>Back to Content Studio</a>
          </Button>
        ) : (
          <Button asChild variant="ghost">
            <a href={routes.organisations.content.index(organisationId)}>Cancel</a>
          </Button>
        )}
      </div>
    </form>
  );
}
