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
import { generateCaption, rewriteContent } from "@/server/actions/awo";
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
import { routes } from "@/lib/routes";

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

  const effectiveAiAction = normaliseAiAction(aiAction, draftBody);

  const hasGuidedContext = guidedOpen && Boolean(
    guidedTopic || guidedGoal || guidedServiceTreatment || guidedPromotionLevel || guidedCtaMode || guidedExtraDirection,
  );

  function buildGuidedCtx(): GenerationGuidedContext | undefined {
    if (!guidedOpen) return undefined;
    if (!guidedTopic && !guidedGoal && !guidedServiceTreatment && !guidedPromotionLevel && !guidedCtaMode && !guidedExtraDirection) return undefined;
    return {
      topic: guidedTopic || undefined,
      goal: guidedGoal || undefined,
      serviceTreatment: guidedServiceTreatment || undefined,
      specificService: guidedServiceTreatment === "specific_service" && guidedSpecificService ? guidedSpecificService : undefined,
      promotionLevel: guidedPromotionLevel || undefined,
      ctaMode: guidedCtaMode || undefined,
      customCta: guidedCtaMode === "custom" && guidedCustomCta ? guidedCustomCta : undefined,
      extraDirection: guidedExtraDirection || undefined,
    };
  }

  async function handleAiAssist() {
    setAiLoading(true);
    try {
      let suggestion = "";

      if (effectiveAiAction === "generate") {
        const [orgId, prompt, platform, intentHints] = buildGenerateCaptionArgs(
          organisationId,
          aiPrompt,
          draft?.title,
          draft?.scheduledPlatform,
          {
            hasCampaign: Boolean(draft?.campaign),
            contentPillar: draft?.category?.label ?? null,
            userPromptIsExplicit: aiPrompt.trim().length > 0,
          },
        );
        const res = await generateCaption(orgId, prompt, platform, intentHints, buildGuidedCtx());
        suggestion = res.text;
      } else {
        const instruction = rewriteInstructionForAction(effectiveAiAction);
        const res = await rewriteContent(organisationId, draftBody, instruction);
        suggestion = res.text;
      }

      setAiSuggestion(suggestion);
      toast.success("AI suggestion generated.");
    } catch (e) {
      toast.error("Failed to generate AI suggestion");
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  }

  function acceptAiSuggestion() {
    if (!aiSuggestion) return;
    setDraftBody(aiSuggestion);
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
        toast.success(state.message);
        router.push(routes.organisations.content.draft(organisationId, state.resourceId));
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
                <Button type="button" variant="secondary" size="sm" onClick={acceptAiSuggestion}>
                  Accept Suggestion
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAiSuggestion(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

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

        <Field id="categoryId" label="Content pillar" errors={state.fieldErrors?.categoryId}>
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

      {isEdit && (
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
                            if (!draft) return;
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

      {showAssetModal && draft && (
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
