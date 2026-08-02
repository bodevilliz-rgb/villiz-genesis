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

function ReopenButton({ organisationId, draftId }: { organisationId: string; draftId: string }) {
  const [state, formAction] = useActionState(reopenReviewAction, idleState);
  useActionToast(state);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="draftId" value={draftId} />
      <SubmitButton variant="secondary" pendingLabel="Reopening…">
        Reopen review
      </SubmitButton>
    </form>
  );
}

const DECISION_COMMENT_REQUIRED: Record<ReviewDecision, boolean> = {
  approve: false,
  request_changes: true,
  reject: true,
};

function DecisionForm({ organisationId, draftId }: { organisationId: string; draftId: string }) {
  const [state, formAction] = useActionState(recordReviewDecisionAction, idleState);
  useActionToast(state);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);

  if (!decision) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => setDecision("approve")}>
          {REVIEW_DECISION_LABELS.approve}
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
      onSubmit={() => {
        // Keep the decision buttons collapsed once the request lands.
        setTimeout(() => setDecision(null), 0);
      }}
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
        >
          Confirm {REVIEW_DECISION_LABELS[decision].toLowerCase()}
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
}: {
  organisationId: string;
  draft: ContentDraft;
  eligibleReviewers: EligibleReviewer[];
  actorId: string;
  canWrite: boolean;
  canLead: boolean;
}) {
  const isSelfAuthored = draft.createdBy?.id === actorId;
  const isAssignedReviewer = draft.assignedReviewer?.id === actorId;
  /**
   * submitForReview() lands a fresh submission on "needs_review", not
   * "in_review" — CONTENT_DRAFT_STATUS_LABELS displays both as "In review",
   * so the two are already treated as the same state everywhere else in the
   * UI. The decision buttons must recognise both too, or a draft fresh out
   * of Submit for Review shows no Approve/Reject/Request Changes controls
   * even though the backend's review engine already accepts decisions from
   * either status (see REVIEW_TRANSITIONS' "needs_review" rows).
   */
  const isAwaitingReviewDecision = draft.status === "in_review" || draft.status === "needs_review";
  /** Buttons are visible only to the reviewer this draft was actually assigned to, or an Account Lead — not just anyone with org-wide reviewer permission. */
  const canDecide = isAssignedReviewer || canLead;

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
            isSelfAuthored ? (
              <p className="text-[12px] text-subtle-foreground">
                You cannot approve, request changes on, or archive your own draft. Ask another Lead or Reviewer.
              </p>
            ) : (
              <DecisionForm organisationId={organisationId} draftId={draft.id} />
            )
          ) : (
            <p className="text-[12px] text-subtle-foreground">Waiting on a Lead or Reviewer.</p>
          )
        ) : null}

        {(draft.status === "approved" || draft.status === "archived") && canLead ? (
          <ReopenButton organisationId={organisationId} draftId={draft.id} />
        ) : null}
      </div>
    </div>
  );
}
