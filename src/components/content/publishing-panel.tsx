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
import { formatRelative } from "@/lib/format";

function useActionToast(state: { status: "idle" | "success" | "error"; message: string }) {
  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);
}

export function PublishingPanel({
  organisationId,
  draft,
  canWrite,
}: {
  organisationId: string;
  draft: ContentDraft;
  canWrite: boolean;
}) {
  const [scheduleState, scheduleAction] = useActionState(createScheduledPublishingJobAction, idleState);
  const [publishState, publishAction] = useActionState(createImmediatePublishingJobAction, idleState);
  const [archiveState, archiveAction] = useActionState(archiveDraftAction, idleState);
  const [duplicateState, duplicateAction] = useActionState(duplicateDraftAction, idleState);

  useActionToast(scheduleState);
  useActionToast(publishState);
  useActionToast(archiveState);
  useActionToast(duplicateState);

  const [platform, setPlatform] = useState("linkedin");
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

          {/* Schedule Form */}
          {isPublishable && (
            <form ref={scheduleFormRef} action={scheduleAction} className="flex flex-col gap-3.5 border-t border-border pt-3">
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="id" value={draft.id} />
              <input type="hidden" name="idempotencyKey" value={scheduleIdempotencyKey} />

              <span className="text-[11px] uppercase tracking-wider text-subtle-foreground font-semibold">Schedule Post</span>

              <Field id="platform" label="Destination Platform">
                <Select id="platform" name="platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  <option value="linkedin">LinkedIn</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="x">X</option>
                </Select>
              </Field>

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

              <Button type="button" onClick={(e) => handlePublishIntercept(e, "schedule")}>Schedule</Button>
            </form>
          )}

          {/* Publish Now Action */}
          {isPublishable && (
            <form ref={publishFormRef} action={publishAction} className="flex flex-col gap-3.5 border-t border-border pt-3">
              <input type="hidden" name="organisationId" value={organisationId} />
              <input type="hidden" name="id" value={draft.id} />
              <input type="hidden" name="platform" value={platform} />
              <input type="hidden" name="idempotencyKey" value={publishIdempotencyKey} />
              <input type="hidden" name="devSimulationMode" value={devSimulationMode} />

              <Field id="publish-now-platform" label="Destination Platform">
                <Select id="publish-now-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  <option value="linkedin">LinkedIn</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="x">X</option>
                </Select>
              </Field>

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

              <Button type="button" variant="secondary" className="w-full" onClick={(e) => handlePublishIntercept(e, "publish")}>
                Publish Now
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
