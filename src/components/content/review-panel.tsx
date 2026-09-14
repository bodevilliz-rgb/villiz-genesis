"use client";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  assignReviewerAction,
  recordReviewDecisionAction,
  reopenReviewAction,
  submitForReviewAction,
} from "@/server/actions/review";
import { idleState } from "@/server/action-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field } from "@/components/ui/field";
import { ChevronRight } from "lucide-react";
import {
  CONTENT_DRAFT_STATUS_LABELS,
  isContentDraftLocked,
  type ContentDraft,
  type ContentDraftStatus,
} from "@/core/domain/entities/content";
import { REVIEW_DECISION_LABELS, type ReviewDecision } from "@/core/domain/entities/review";
import type { EligibleReviewer } from "@/core/application/use-cases/review";

const STATUS_TONE: Record<ContentDraftStatus, "muted" | "warning" | "positive" | "danger"> = {
  draft: "muted",
  needs_review: "warning",
  in_review: "warning",
  changes_requested: "warning",
  awaiting_client: "warning",
  approved: "positive",
  rejected: "danger",
  scheduled: "positive",
  publishing: "positive",
  published: "positive",
  failed: "danger",
  archived: "muted",
};

function useActionToast(state: { status: "idle" | "success" | "error"; message: string }) {
  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);
}

function AssignReviewerControl({
  organisationId,
  draftId,
  reviewers,
  currentReviewerId,
}: {
  organisationId: string;
  draftId: string;
  reviewers: EligibleReviewer[];
  currentReviewerId: string | null;
}) {
  const [state, formAction] = useActionState(assignReviewerAction, idleState);
  useActionToast(state);

  if (reviewers.length === 0) {
    return <p className="text-[12px] text-subtle-foreground">No Lead or Reviewer is assigned to this account yet.</p>;
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="draftId" value={draftId} />
      <Select name="reviewerId" defaultValue={currentReviewerId ?? ""} className="flex-1" aria-label="Assign reviewer">
        <option value="" disabled>
          Choose a reviewer
        </option>
        {reviewers.map((reviewer) => (
          <option key={reviewer.id} value={reviewer.id}>
            {reviewer.fullName ?? reviewer.email}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
        {currentReviewerId ? "Reassign" : "Assign"}
      </SubmitButton>
    </form>
  );
}

function SubmitForReviewButton({ organisationId, draftId }: { organisationId: string; draftId: string }) {
  const [state, formAction] = useActionState(submitForReviewAction, idleState);
  useActionToast(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="draftId" value={draftId} />
      <SubmitButton pendingLabel="Submitting…">Submit for review</SubmitButton>
    </form>
  );
}

function ReopenButton({ organisationId, draftId, label = "Reopen review" }: { organisationId: string; draftId: string; label?: string }) {
  const [state, formAction] = useActionState(reopenReviewAction, idleState);
  useActionToast(state);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="draftId" value={draftId} />
      <SubmitButton variant="secondary" pendingLabel="Reopening…">
        {label}
      </SubmitButton>
    </form>
  );
}

const DECISION_COMMENT_REQUIRED: Record<ReviewDecision, boolean> = {
  approve: false,
  request_changes: true,
  reject: true,
};

// Determine the approval button label based on draft scheduling status
export function getApprovalLabel(draft: ContentDraft): string {
  if (draft.scheduledAt) {
    const scheduledDate = new Date(draft.scheduledAt);
    const now = new Date();
    if (scheduledDate <= now) {
      return "Choose New Date";
    }
    return "Approve & Schedule";
  }
  return "Publish Now";
}

function DecisionForm({
  organisationId,
  draftId,
  draft,
  approvalBlocked = false,
  blockedByPastDate = false,
}: {
  organisationId: string;
  draftId: string;
  draft: ContentDraft;
  approvalBlocked?: boolean;
  blockedByPastDate?: boolean;
}) {
  const [state, formAction] = useActionState(recordReviewDecisionAction, idleState);
  useActionToast(state);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);

  useEffect(() => {
    if (state.status === "success") setDecision(null);
  }, [state.status]);

  if (!decision) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => setDecision("approve")}
          disabled={approvalBlocked || blockedByPastDate}
        >
          {getApprovalLabel(draft)}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDecision("request_changes")}>
          {REVIEW_DECISION_LABELS.request_changes}
        </Button>
        <Button variant="danger" size="sm" onClick={() => setDecision("reject")}>
          {REVIEW_DECISION_LABELS.reject}
        </Button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2.5"
    >
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="decision" value={decision} />

      <Field
        id="comment"
        label={`Comment${DECISION_COMMENT_REQUIRED[decision] ? "" : " (optional)"}`}
        errors={state.fieldErrors?.comment}
      >
        <Textarea id="comment" name="comment" rows={3} placeholder="Explain your decision" />
      </Field>

      <div className="flex items-center gap-2">
        <SubmitButton
          variant={decision === "reject" ? "danger" : "primary"}
          size="sm"
          pendingLabel="Saving…"
          disabled={approvalBlocked || blockedByPastDate}
        >
          {decision === "approve" ? getApprovalLabel(draft) : `Confirm ${REVIEW_DECISION_LABELS[decision].toLowerCase()}`}
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDecision(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ReviewPanel({
  organisationId,
  draft,
  eligibleReviewers,
  actorId,
  canWrite,
  canLead,
  distributionApproval,
}: {
  organisationId: string;
  draft: ContentDraft;
  eligibleReviewers: EligibleReviewer[];
  actorId: string;
  canWrite: boolean;
  canLead: boolean;
  /** Server-derived display hint. The approval use-case independently
   * rechecks organisation membership before accepting the decision. */
  distributionApproval?: { blocked: boolean; blockers: string[]; warnings: string[] };
}) {
  const isAssignedReviewer = draft.assignedReviewer?.id === actorId;
  const isAwaitingReviewDecision = draft.status === "in_review" || draft.status === "needs_review";
  const canDecide = isAssignedReviewer || canLead;

  // Check if scheduled date has passed
  const scheduledDate = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
  const now = new Date();
  const isPastDate = scheduledDate ? scheduledDate <= now : false;
  const blockedByPastDate = draft.status === "approved" && isPastDate;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge tone={STATUS_TONE[draft.status]}>{CONTENT_DRAFT_STATUS_LABELS[draft.status]}</Badge>
        {isContentDraftLocked(draft.status) ? (
          <span className="text-[11px] text-subtle-foreground">Locked until reopened</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-subtle-foreground">Assigned reviewer</span>
        <p className="text-[13px]">
          {draft.assignedReviewer ? draft.assignedReviewer.fullName ?? draft.assignedReviewer.email : "Unassigned"}
        </p>
        {canLead ? (
          <AssignReviewerControl
            organisationId={organisationId}
            draftId={draft.id}
            reviewers={eligibleReviewers}
            currentReviewerId={draft.assignedReviewer?.id ?? null}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {(draft.status === "draft" || draft.status === "changes_requested") && canWrite ? (
          <SubmitForReviewButton organisationId={organisationId} draftId={draft.id} />
        ) : null}

        {isAwaitingReviewDecision ? (
          canDecide ? (
            <div className="flex flex-col gap-2">
              {/* Past date warning — show inline reschedule action */}
              {blockedByPastDate && (
                <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] text-muted-foreground">
                  <p className="font-semibold text-foreground">Scheduled date has passed</p>
                  <p>The scheduled date is in the past. Update the scheduling section to choose a new date.</p>
                </div>
              )}

              {/* Critical blockers only — these still block approval */}
              {distributionApproval && distributionApproval.blocked && (
                <div className="rounded-md border border-danger/40 bg-danger-soft p-3 text-[12px] text-danger" role="alert">
                  <p className="font-semibold">Approval blocked · Critical safety check</p>
                  <ul className="mt-2 grid gap-1 pl-4">{distributionApproval.blockers.map((blocker) => <li className="list-disc" key={blocker}>{blocker}</li>)}</ul>
                </div>
              )}

              {/* Non-critical warnings — shown but don't block approval */}
              {distributionApproval && distributionApproval.warnings && distributionApproval.warnings.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] text-muted-foreground">
                  <p className="font-semibold text-foreground">Distribution recommendation warnings</p>
                  <ul className="mt-1 grid gap-0.5 pl-4 list-disc">
                    {distributionApproval.warnings.map((warning) => (
                      <li key={warning} className="list-disc pl-1">{warning}</li>
                    ))}
                  </ul>
                  <p className="mt-1">These are advisory only and will not block approval.</p>
                </div>
              )}

              {/* Collapsed Quality Details section */}
              {distributionApproval && (
                <details className="rounded-md border border-border/50 bg-background/50">
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12px] text-subtle-foreground hover:text-foreground">
                    <ChevronRight className="size-3.5 transition-transform" />
                    Quality Details — Distribution Gate
                  </summary>
                  <div className="px-3 pb-2 text-[12px]">
                    {distributionApproval.blocked ? (
                      <p className="text-danger">Status: Blocked by critical safety issues</p>
                    ) : (
                      <p className="text-positive">Status: Passed critical safety checks</p>
                    )}
                    {distributionApproval.warnings.length > 0 && (
                      <>
                        <p className="mt-1.5 font-semibold text-foreground">Advisory warnings:</p>
                        <ul className="pl-4 list-disc">
                          {distributionApproval.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {distributionApproval.blockers.length > 0 && (
                      <>
                        <p className="mt-1.5 font-semibold text-foreground">Critical blockers:</p>
                        <ul className="pl-4 list-disc">
                          {distributionApproval.blockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </details>
              )}

              <DecisionForm
                organisationId={organisationId}
                draftId={draft.id}
                draft={draft}
                approvalBlocked={Boolean(distributionApproval && distributionApproval.blocked)}
                blockedByPastDate={blockedByPastDate}
              />
            </div>
          ) : (
            <p className="text-[12px] text-subtle-foreground">Waiting on a Lead or Reviewer.</p>
          )
        ) : null}

        {(draft.status === "approved" || draft.status === "archived" || draft.status === "failed") && canLead ? (
          <ReopenButton organisationId={organisationId} draftId={draft.id} label={draft.status === "failed" ? "Reopen for correction" : "Reopen review"} />
        ) : null}
      </div>
    </div>
  );
}