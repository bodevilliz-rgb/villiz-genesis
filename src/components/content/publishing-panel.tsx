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
import { PUBLISHING_PLATFORM_LABELS } from "@/core/domain/entities/publishing";
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
  const [scheduleState, scheduleAction] = useActionState(createScheduledPublishingJobAction, idleState);
  const [publishState, publishAction] = useActionState(createImmediatePublishingJobAction, idleState);
  const [archiveState, archiveAction] = useActionState(archiveDraftAction, idleState);
  const [duplicateState, duplicateAction] = useActionState(duplicateDraftAction, idleState);

  useActionToast(scheduleState);
  useActionToast(publishState);
  useActionToast(archiveState);
  useActionToast(duplicateState);

  const [timezone, setTimezone] = useState("UTC");
  const [scheduledAt, setScheduledAt] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"publish" | "schedule" | null>(null);

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
  const canPublish = isPublishable && !!derivedPlatform && !!selectedAccountId;

  const handlePublishIntercept = (e: React.MouseEvent, type: "publish" | "schedule") => {
    e.preventDefault();
    setPendingAction(type);
    setDialogOpen(true);
  };

  const confirmAction = () => {
    setDialogOpen(false);
    if (pendingAction === "publish" && publishFormRef.current) {
      publishFormRef.current.requestSubmit();
    } else if (pendingAction === "schedule" && scheduleFormRef.current) {
      scheduleFormRef.current.requestSubmit();
    }
    setPendingAction(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <PrePublishDialog
        organisationId={organisationId}
        draft={draft}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirmPublish={confirmAction}
        channel={selectedAccount}
        isLivePublishing={isLivePublishing}
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

          {/* Schedule Form */}
          {isPublishable && (
            <form ref={scheduleFormRef} action={scheduleAction} className="flex flex-col gap-3.5 border-t border-border pt-3">
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="id" value={draft.id} />
              <input type="hidden" name="idempotencyKey" value={scheduleIdempotencyKey} />
              <input type="hidden" name="platform" value={derivedPlatform ?? ""} />
              <input type="hidden" name="resolvedAccountId" value={selectedAccountId ?? ""} />

              <span className="text-[11px] uppercase tracking-wider text-subtle-foreground font-semibold">Schedule Post</span>

              <Field id="scheduledAt" label="Scheduled Date & Time">
                <Input
                  id="scheduledAt"
                  name="scheduledAt"
                  type="datetime-local"
                  required
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </Field>

              <Field id="timezone" label="Timezone">
                <Select id="timezone" name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  <option value="UTC">UTC</option>
                  <option value="EST">EST</option>
                  <option value="PST">PST</option>
                  <option value="GMT">GMT</option>
                  <option value="CET">CET</option>
                </Select>
              </Field>

              <Button
                type="button"
                size="lg"
                disabled={!canPublish}
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
                disabled={!canPublish}
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
