"use client";
import { useActionState, useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PrePublishDialog } from "./pre-publish-dialog";
import { archiveDraftAction, duplicateDraftAction } from "@/server/actions/content";
import { createImmediatePublishingJobAction, createScheduledPublishingJobAction } from "@/server/actions/publishing";
import { idleState } from "@/server/action-result";
import type { ContentDraft } from "@/core/domain/entities/content";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import { mapBlotatoPlatform } from "@/core/domain/entities/blotato";
import { PUBLISHING_PLATFORM_LABELS, type PublishingIntent } from "@/core/domain/entities/publishing";
import { convertLocalTimeToUtc, formatInTimeZone, listSupportedTimeZones } from "@/core/domain/entities/scheduling";
import { formatRelative } from "@/lib/format";

function useActionToast(state: { status: "idle" | "success" | "error"; message: string }) {
  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);
}

/** Human-readable label for the Blotato platform string — falls back to the raw string for unsupported platforms. */
function channelPlatformLabel(ch: BlotatoAccount): string {
  const genesis = mapBlotatoPlatform(ch.platform);
  return genesis ? PUBLISHING_PLATFORM_LABELS[genesis] : ch.platform;
}

/** The identity string shown alongside the platform label. */
function channelIdentity(ch: BlotatoAccount): string {
  if (ch.username) return `@${ch.username}`;
  if (ch.fullname) return ch.fullname;
  return ch.id;
}

/** Encodes the intent snapshot's two commercial-disclosure booleans into the single hidden field the server's parseCommercialDisclosure expects — the exact inverse of that parser. "" when either field is unset (never declared, or not a TikTok destination). */
function commercialDisclosureFormValue(intent: PublishingIntent | null): string {
  if (!intent) return "";
  const isYourBrand = "isYourBrand" in intent ? intent.isYourBrand : null;
  const isBrandedContent = "isBrandedContent" in intent ? intent.isBrandedContent : null;
  if (isYourBrand == null || isBrandedContent == null) return "";
  if (isYourBrand && isBrandedContent) return "both";
  if (isYourBrand) return "own";
  if (isBrandedContent) return "branded";
  return "none";
}

export function PublishingPanel({
  organisationId,
  draft,
  canWrite,
  channels = [],
  isLivePublishing = false,
}: {
  organisationId: string;
  draft: ContentDraft;
  canWrite: boolean;
  /** Active channels assigned to this organisation — used to populate the destination selector. */
  channels?: BlotatoAccount[];
  /** Whether the Blotato integration is in live-publishing mode. False = simulation only. */
  isLivePublishing?: boolean;
}) {
  const [scheduleState, scheduleAction, schedulePending] = useActionState(createScheduledPublishingJobAction, idleState);
  const [publishState, publishAction, publishPending] = useActionState(createImmediatePublishingJobAction, idleState);
  const [archiveState, archiveAction] = useActionState(archiveDraftAction, idleState);
  const [duplicateState, duplicateAction] = useActionState(duplicateDraftAction, idleState);

  useActionToast(scheduleState);
  useActionToast(publishState);
  useActionToast(archiveState);
  useActionToast(duplicateState);

  // Detected once, from the operator's own browser — a safe, generic default
  // for every organisation/region with zero client-specific hardcoding.
  // Genesis does not yet have an organisation-level default timezone setting
  // (audited: no such field exists on the organisation entity) — this is the
  // documented follow-up if one is wanted later.
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const supportedTimeZones = useState(() => listSupportedTimeZones())[0];

  const [dialogOpen, setDialogOpen] = useState(false);
  // Captured ONCE, at the exact moment the operator clicks Publish Now or
  // Schedule — immutable for the lifetime of this review. Nothing inside
  // Pre-Publish Review can change intent.mode, drop scheduledForUtc, or
  // swap the destination; the review only ever evaluates this snapshot.
  const [intent, setIntent] = useState<PublishingIntent | null>(null);
  const [scheduleTimeError, setScheduleTimeError] = useState<string | null>(null);

  const scheduleFormRef = useRef<HTMLFormElement>(null);
  const publishFormRef = useRef<HTMLFormElement>(null);

  // Minted once per mount, not inside the server action — a double-click or
  // an action retry submits the SAME key both times (same in-flight form
  // instance), so the publishing engine's idempotency guarantee actually
  // holds. Re-opening the panel (a fresh mount) is a new logical request and
  // correctly gets a new key.
  const [publishIdempotencyKey] = useState(() => crypto.randomUUID());
  const [scheduleIdempotencyKey] = useState(() => crypto.randomUUID());

  const isPublishable = draft.status === "approved" || draft.status === "scheduled" || draft.status === "failed";

  // Next.js inlines NODE_ENV into the client bundle at build time (the same
  // mechanism React itself relies on for its own dev/prod branching), so this
  // check is real and cannot be flipped by a user — it is baked into the
  // production JS as `"production" !== "production"`, i.e. permanently false.
  const [devSimulationMode, setDevSimulationMode] = useState<"always_succeed" | "fail_next_attempt" | "always_fail">(
    "always_succeed",
  );
  const showSimulationControls = process.env.NODE_ENV !== "production";

  // Only show channels whose Blotato platform maps to one of the 4 supported Genesis platforms.
  const supportedChannels = channels.filter((ch) => mapBlotatoPlatform(ch.platform) !== null);

  // Auto-select the sole channel so single-account orgs need zero clicks.
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    () => (supportedChannels.length === 1 ? supportedChannels[0]!.id : null),
  );

  const selectedAccount = supportedChannels.find((c) => c.id === selectedAccountId) ?? null;
  const derivedPlatform = selectedAccount ? mapBlotatoPlatform(selectedAccount.platform) : null;

  // TikTok-only per-post compliance declaration. Deliberately starts null
  // (no default — the operator must actively choose Yes or No) and is only
  // meaningful when the destination is TikTok; the server's deterministic
  // preflight is the real authority and blocks live publishing while null.
  const [aiDisclosure, setAiDisclosure] = useState<boolean | null>(null);
  const requiresAiDisclosure = derivedPlatform === "tiktok";
  const aiDisclosureMissing = requiresAiDisclosure && aiDisclosure === null;

  // TikTok-only commercial-content declaration (developers.tiktok.com/doc/
  // content-sharing-guidelines): "Your Brand" and "Branded Content" are
  // independent — "own" and "branded" may both apply. Three checkboxes
  // with mutual exclusion between "no commercial content" and the other
  // two (checking either of the other two clears "none"; checking "none"
  // clears the other two). No box starts checked. Deliberately computed
  // from the raw checkbox state, not a separate "touched" flag — unchecking
  // back to an all-false state (without explicitly re-checking "none") is
  // indistinguishable from never having chosen, which is the correct
  // fail-closed behaviour: only an active selection counts as a declaration.
  const [commercialNone, setCommercialNone] = useState(false);
  const [commercialOwnBrand, setCommercialOwnBrand] = useState(false);
  const [commercialBranded, setCommercialBranded] = useState(false);
  const requiresCommercialDisclosure = derivedPlatform === "tiktok";
  const commercialSelection: "none" | "own" | "branded" | "both" | null = commercialNone
    ? "none"
    : commercialOwnBrand && commercialBranded
      ? "both"
      : commercialOwnBrand
        ? "own"
        : commercialBranded
          ? "branded"
          : null;
  const commercialDisclosureMissing = requiresCommercialDisclosure && commercialSelection === null;

  function checkCommercialNone() {
    setCommercialNone(true);
    setCommercialOwnBrand(false);
    setCommercialBranded(false);
  }
  function toggleCommercialOwnBrand() {
    setCommercialOwnBrand((prev) => {
      const next = !prev;
      if (next) setCommercialNone(false);
      return next;
    });
  }
  function toggleCommercialBranded() {
    setCommercialBranded((prev) => {
      const next = !prev;
      if (next) setCommercialNone(false);
      return next;
    });
  }

  // TikTok's own developer content-sharing guidelines require the posting
  // CLIENT (Genesis) to display this exact acknowledgement before the
  // publish button — Blotato's API exposes no field for it, so there is
  // nothing to persist or send; this is UI text only. Expands to include
  // the Branded Content Policy per TikTok's specified composition when
  // branded/paid-partnership content is selected.
  const tiktokMusicUsageText =
    commercialSelection === "branded" || commercialSelection === "both"
      ? "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation."
      : "By posting, you agree to TikTok's Music Usage Confirmation.";

  const canPublish =
    isPublishable && !!derivedPlatform && !!selectedAccountId && !aiDisclosureMissing && !commercialDisclosureMissing;

  const handlePublishIntercept = (e: React.MouseEvent, type: "publish" | "schedule") => {
    e.preventDefault();
    setScheduleTimeError(null);

    if (!derivedPlatform || !selectedAccountId || aiDisclosureMissing || commercialDisclosureMissing) return;

    const intentAiDisclosure = requiresAiDisclosure ? aiDisclosure : null;
    const intentIsYourBrand = requiresCommercialDisclosure
      ? commercialSelection === "own" || commercialSelection === "both"
      : null;
    const intentIsBrandedContent = requiresCommercialDisclosure
      ? commercialSelection === "branded" || commercialSelection === "both"
      : null;

    if (type === "publish") {
      setIntent({
        mode: "immediate",
        organisationId,
        draftId: draft.id,
        platform: derivedPlatform,
        resolvedAccountId: selectedAccountId,
        isAiGenerated: intentAiDisclosure,
        isYourBrand: intentIsYourBrand,
        isBrandedContent: intentIsBrandedContent,
      });
      setDialogOpen(true);
      return;
    }

    // Fail fast in the browser — the same rule the server enforces
    // authoritatively (createScheduledPublishingJobAction, via the same
    // convertLocalTimeToUtc) — so an invalid/nonexistent local time never
    // even reaches Pre-Publish Review.
    let scheduledForUtc: Date;
    try {
      scheduledForUtc = convertLocalTimeToUtc(scheduledAt, timezone);
    } catch (err) {
      setScheduleTimeError(err instanceof Error ? err.message : "That date and time could not be understood.");
      return;
    }

    setIntent({
      mode: "scheduled",
      organisationId,
      draftId: draft.id,
      platform: derivedPlatform,
      resolvedAccountId: selectedAccountId,
      isAiGenerated: intentAiDisclosure,
      isYourBrand: intentIsYourBrand,
      isBrandedContent: intentIsBrandedContent,
      scheduledForUtc: scheduledForUtc.toISOString(),
      displayTimezone: timezone,
      scheduledForLocalDisplay: formatInTimeZone(scheduledForUtc, timezone),
    });
    setDialogOpen(true);
  };

  const isConfirmPending = schedulePending || publishPending;

  const confirmAction = () => {
    // Defense in depth against a double-fire of the confirm handler — the
    // dialog's own button is already disabled while pending, but this
    // guarantees a stale re-invocation (e.g. a queued event) can never
    // submit twice or submit both actions.
    if (isConfirmPending || !intent) return;
    if (intent.mode === "immediate" && publishFormRef.current) {
      publishFormRef.current.requestSubmit();
    } else if (intent.mode === "scheduled" && scheduleFormRef.current) {
      scheduleFormRef.current.requestSubmit();
    }
  };

  // Close the dialog only once the underlying action reaches a terminal
  // state — mirrors the approval-flow fix (DecisionForm) that removed a
  // premature unmount as the source of double-submission on retry. The
  // confirm button stays disabled for the entire in-flight duration.
  useEffect(() => {
    if (scheduleState.status === "success" || scheduleState.status === "error") {
      setDialogOpen(false);
      setIntent(null);
    }
  }, [scheduleState]);

  useEffect(() => {
    if (publishState.status === "success" || publishState.status === "error") {
      setDialogOpen(false);
      setIntent(null);
    }
  }, [publishState]);

  return (
    <div className="flex flex-col gap-4">
      <PrePublishDialog
        organisationId={organisationId}
        draft={draft}
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setIntent(null);
        }}
        onConfirmPublish={confirmAction}
        channel={selectedAccount}
        isLivePublishing={isLivePublishing}
        intent={intent}
        submitting={isConfirmPending}
      />

      {/* Draft Status Info */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-subtle-foreground">Publishing status</span>
        <p className="text-[13px] font-medium capitalize">{draft.status}</p>

        {draft.status === "scheduled" && (
          <div className="rounded border border-border bg-card p-2.5 text-[12px] flex flex-col gap-1">
            <p><strong>Platform:</strong> <span className="uppercase">{draft.scheduledPlatform}</span></p>
            <p><strong>Date:</strong> {draft.scheduledAt ? formatRelative(draft.scheduledAt) : ""}</p>
            <p><strong>Timezone:</strong> {draft.scheduledTimezone}</p>
          </div>
        )}
      </div>

      {canWrite && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {/* Duplicate Action */}
          <form action={duplicateAction}>
            <input type="hidden" name="organisationId" value={organisationId} />
            <input type="hidden" name="id" value={draft.id} />
            <SubmitButton variant="secondary" className="w-full" pendingLabel="Duplicating…">
              Duplicate Draft
            </SubmitButton>
          </form>

          {/* Archive Action */}
          {draft.status !== "archived" && (
            <form action={archiveAction}>
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="id" value={draft.id} />
              <SubmitButton variant="ghost" className="w-full text-danger hover:bg-danger/5" pendingLabel="Archiving…">
                Archive Draft
              </SubmitButton>
            </form>
          )}

          {/* Simulation mode banner */}
          {!isLivePublishing && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
              <strong>Simulation mode</strong> — the publishing engine is active but no content is sent to any social platform. Enable live publishing in the platform configuration to go live.
            </div>
          )}

          {/* Destination channel selector */}
          {isPublishable && (
            <div className="flex flex-col gap-2.5 border-t border-border pt-3">
              <span className="text-[11px] uppercase tracking-wider text-subtle-foreground font-semibold">Destination</span>

              {supportedChannels.length === 0 ? (
                <p className="text-[12px] text-subtle-foreground leading-relaxed">
                  No channels connected. Assign one from{" "}
                  <strong>Organisation Settings → Connected Channels</strong> before publishing.
                </p>
              ) : (
                <Field id="channel-select" label="Publish to">
                  <Select
                    id="channel-select"
                    value={selectedAccountId ?? ""}
                    onChange={(e) => setSelectedAccountId(e.target.value || null)}
                    disabled={dialogOpen}
                  >
                    {supportedChannels.length > 1 && <option value="">Select a destination…</option>}
                    {supportedChannels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {channelPlatformLabel(ch)} · {channelIdentity(ch)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          )}

          {/* TikTok AI-generated-content declaration — required, no default */}
          {isPublishable && requiresAiDisclosure && (
            <fieldset className="flex flex-col gap-2.5 border-t border-border pt-3" disabled={dialogOpen}>
              <legend className="sr-only">AI-generated content declaration</legend>
              <span className="text-[11px] uppercase tracking-wider text-subtle-foreground font-semibold">
                AI-generated content?
              </span>
              <p className="text-[12px] text-subtle-foreground leading-relaxed">
                TikTok requires an accurate disclosure when a post&rsquo;s caption, image, or video was
                created or significantly edited with AI. Your answer labels this specific post on TikTok —
                choose what is true for this content.
              </p>
              <div className="flex gap-2">
                <label className="flex flex-1 items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="tiktok-ai-disclosure-choice"
                    className="accent-primary"
                    checked={aiDisclosure === true}
                    onChange={() => setAiDisclosure(true)}
                  />
                  <span className="text-[13px] font-medium">Yes — AI-generated</span>
                </label>
                <label className="flex flex-1 items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="tiktok-ai-disclosure-choice"
                    className="accent-primary"
                    checked={aiDisclosure === false}
                    onChange={() => setAiDisclosure(false)}
                  />
                  <span className="text-[13px] font-medium">No — not AI-generated</span>
                </label>
              </div>
              {aiDisclosureMissing && (
                <p className="text-[12px] text-subtle-foreground">
                  Choose Yes or No before publishing or scheduling to TikTok.
                </p>
              )}
            </fieldset>
          )}

          {/* TikTok commercial-content declaration — required, no default */}
          {isPublishable && requiresCommercialDisclosure && (
            <fieldset className="flex flex-col gap-2.5 border-t border-border pt-3" disabled={dialogOpen}>
              <legend className="sr-only">Commercial content declaration</legend>
              <span className="text-[11px] uppercase tracking-wider text-subtle-foreground font-semibold">
                Commercial content
              </span>
              <p className="text-[12px] text-subtle-foreground leading-relaxed">
                Does this post promote a brand, product, or service? TikTok requires this disclosure on
                every post. Own brand and paid partnership can both apply.
              </p>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={commercialNone}
                    onChange={checkCommercialNone}
                  />
                  <span className="text-[13px] font-medium">No commercial content</span>
                </label>
                <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={commercialOwnBrand}
                    onChange={toggleCommercialOwnBrand}
                  />
                  <span className="text-[13px] font-medium">My / our own brand or business</span>
                </label>
                <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={commercialBranded}
                    onChange={toggleCommercialBranded}
                  />
                  <span className="text-[13px] font-medium">Another brand / paid partnership</span>
                </label>
              </div>
              {commercialDisclosureMissing && (
                <p className="text-[12px] text-subtle-foreground">
                  Choose an option before publishing or scheduling to TikTok.
                </p>
              )}
              <p className="text-[11px] text-subtle-foreground leading-relaxed">{tiktokMusicUsageText}</p>
            </fieldset>
          )}

          {/* Schedule Form */}
          {isPublishable && (
            <form ref={scheduleFormRef} action={scheduleAction} className="flex flex-col gap-3.5 border-t border-border pt-3">
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="id" value={draft.id} />
              <input type="hidden" name="idempotencyKey" value={scheduleIdempotencyKey} />
              <input type="hidden" name="platform" value={derivedPlatform ?? ""} />
              <input type="hidden" name="resolvedAccountId" value={selectedAccountId ?? ""} />
              {/*
                A native `disabled` form control is EXCLUDED from FormData on
                submission — that's standard HTML, not a bug. The visible
                scheduledAt/timezone controls below become disabled the moment
                the review dialog opens (so nothing can drift from what's
                under review), but confirmAction() submits this form WHILE
                the dialog is still open (it closes only after the action
                settles) — so submitting straight from those controls would
                silently omit them. These two ALWAYS-enabled hidden inputs
                carry the immutable intent snapshot instead; the server reads
                these, never the visible controls' live (and, at submit time,
                disabled) values. Root cause of a confirmed "Schedule Post"
                reaching the server with an empty scheduledAt.
              */}
              <input type="hidden" name="scheduledForUtc" value={intent?.mode === "scheduled" ? intent.scheduledForUtc : ""} />
              <input type="hidden" name="timezone" value={intent?.mode === "scheduled" ? intent.displayTimezone : timezone} />
              {/* Same always-enabled-hidden-input pattern as scheduledForUtc above:
                  carries the immutable intent snapshot's AI declaration ("" = never
                  declared; the server treats anything but "true"/"false" as null). */}
              <input type="hidden" name="isAiGenerated" value={intent?.isAiGenerated != null ? String(intent.isAiGenerated) : ""} />
              <input type="hidden" name="commercialDisclosure" value={commercialDisclosureFormValue(intent)} />

              <span className="text-[11px] uppercase tracking-wider text-subtle-foreground font-semibold">Schedule Post</span>

              <Field id="scheduledAt" label="Scheduled Date & Time">
                <Input
                  id="scheduledAt"
                  type="datetime-local"
                  required
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  disabled={dialogOpen}
                />
              </Field>

              <Field id="timezone-display" label="Timezone">
                <Select
                  id="timezone-display"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={dialogOpen}
                >
                  {supportedTimeZones.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </Select>
              </Field>

              {scheduleTimeError && (
                <p className="text-[12px] text-danger">{scheduleTimeError}</p>
              )}

              <Button
                type="button"
                size="lg"
                disabled={!canPublish || dialogOpen}
                onClick={(e) => handlePublishIntercept(e, "schedule")}
              >
                Schedule
              </Button>
            </form>
          )}

          {/* Publish Now Action */}
          {isPublishable && (
            <form ref={publishFormRef} action={publishAction} className="flex flex-col gap-3.5 border-t border-border pt-3">
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="id" value={draft.id} />
              <input type="hidden" name="platform" value={derivedPlatform ?? ""} />
              <input type="hidden" name="resolvedAccountId" value={selectedAccountId ?? ""} />
              <input type="hidden" name="idempotencyKey" value={publishIdempotencyKey} />
              <input type="hidden" name="devSimulationMode" value={devSimulationMode} />
              {/* Immutable intent snapshot's AI declaration — see the schedule form's identical input. */}
              <input type="hidden" name="isAiGenerated" value={intent?.isAiGenerated != null ? String(intent.isAiGenerated) : ""} />
              <input type="hidden" name="commercialDisclosure" value={commercialDisclosureFormValue(intent)} />

              {showSimulationControls && (
                <Field id="dev-simulation-mode" label="Dev: mock publish outcome">
                  <Select
                    id="dev-simulation-mode"
                    value={devSimulationMode}
                    onChange={(e) => setDevSimulationMode(e.target.value as typeof devSimulationMode)}
                  >
                    <option value="always_succeed">Always succeed</option>
                    <option value="fail_next_attempt">Fail next attempt (one-shot)</option>
                    <option value="always_fail">Always fail</option>
                  </Select>
                </Field>
              )}

              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={!canPublish || dialogOpen}
                onClick={(e) => handlePublishIntercept(e, "publish")}
              >
                Publish Now
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
