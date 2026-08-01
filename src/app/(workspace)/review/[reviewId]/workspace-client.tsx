"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar,
  Copy,
  FileText,
  History,
  MessageSquare,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  CONTENT_DRAFT_STATUS_LABELS,
  CONTENT_DRAFT_TYPE_LABELS,
  type ContentDraft,
  type ContentDraftVersion,
  type CommentThread,
} from "@/core/domain/entities/content";
import type { AuditEvent } from "@/core/application/ports/audit-port";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  submitForReviewAction,
  assignReviewerAction,
  recordReviewDecisionAction,
  reopenReviewAction,
  createCommentAction,
  updateCommentAction,
  resolveCommentAction,
  reopenCommentAction,
  restoreVersionAction,
  duplicateVersionAction,
  archiveDraftAction,
  updatePriorityAndDeadlineAction,
} from "@/server/actions/review";
import { idleState } from "@/server/action-result";

const STATUS_TONE: Record<ContentDraft["status"], "muted" | "warning" | "positive" | "danger"> = {
  draft: "muted",
  needs_review: "warning",
  in_review: "warning",
  changes_requested: "warning",
  awaiting_client: "warning",
  approved: "positive",
  rejected: "danger",
  scheduled: "positive",
  published: "positive",
  archived: "muted",
};

interface WorkspaceProps {
  draft: ContentDraft;
  versions: ContentDraftVersion[];
  comments: CommentThread[];
  auditLogs: AuditEvent[];
  members: { id: string; fullName: string | null; email: string }[];
  viewerRole: string;
  actorId: string;
}

export function ReviewWorkspaceClient({
  draft,
  versions,
  comments,
  auditLogs,
  members,
  viewerRole,
  actorId,
}: WorkspaceProps) {
  const router = useRouter();

  // Left Panel tabs: "preview", "versions", "timeline"
  const [activeLeftTab, setActiveLeftTab] = useState<"preview" | "versions" | "timeline">("preview");

  // Right Panel tabs: "comments", "meta"
  const [activeRightTab, setActiveRightTab] = useState<"comments" | "meta">("comments");

  // Comment edit state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  // Reply state
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  // Form states using useActionState
  const [, submitAction] = useActionState(submitForReviewAction, idleState);
  const [, decisionAction] = useActionState(recordReviewDecisionAction, idleState);
  const [, reopenAction] = useActionState(reopenReviewAction, idleState);
  const [, archiveAction] = useActionState(archiveDraftAction, idleState);

  // Quick toast feedback handlers
  const handleActionComplete = (state: { status: string; message: string }, successMessage: string) => {
    if (state.status === "success") {
      toast.success(state.message || successMessage);
      router.refresh();
    } else if (state.status === "error") {
      toast.error(state.message);
    }
  };

  const isLead = viewerRole === "owner" || viewerRole === "admin";

  return (
    <div className="flex flex-col gap-6 h-full pb-8">
      {/* 1. Header Bar */}
      <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-subtle-foreground mb-1">
            <Link
              href={routes.review}
              className="flex items-center gap-1 hover:text-foreground text-[13px] transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Approval Centre
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight truncate max-w-xl">{draft.title}</h1>
            <Badge tone="muted" className="text-xs">
              {CONTENT_DRAFT_TYPE_LABELS[draft.contentType]}
            </Badge>
            <Badge tone={STATUS_TONE[draft.status]} className="text-xs font-semibold">
              {CONTENT_DRAFT_STATUS_LABELS[draft.status]}
            </Badge>
            {draft.priority && (
              <Badge
                tone={draft.priority === "high" ? "danger" : draft.priority === "medium" ? "warning" : "muted"}
                className="text-xs uppercase"
              >
                {draft.priority} Priority
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[12px] text-subtle-foreground truncate">
            Drafted by {draft.createdBy?.fullName || draft.createdBy?.email} · Version {draft.version}
          </p>
        </div>

        {/* Workflow actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Submit for review button */}
          {(draft.status === "draft" || draft.status === "changes_requested") && (
            <form action={submitAction} onSubmit={() => setTimeout(() => router.refresh(), 500)}>
              <input type="hidden" name="organisationId" value={draft.organisationId} />
              <input type="hidden" name="draftId" value={draft.id} />
              <SubmitButton variant="primary" size="sm">
                Submit for Review
              </SubmitButton>
            </form>
          )}

          {/* Lead/Assigned reviewer action decisions */}
          {draft.status === "in_review" && (
            <div className="flex gap-2">
              <form action={decisionAction} onSubmit={() => setTimeout(() => router.refresh(), 500)}>
                <input type="hidden" name="organisationId" value={draft.organisationId} />
                <input type="hidden" name="draftId" value={draft.id} />
                <input type="hidden" name="decision" value="approve" />
                <SubmitButton variant="primary" size="sm">
                  Approve
                </SubmitButton>
              </form>

              <form action={decisionAction} onSubmit={() => setTimeout(() => router.refresh(), 500)}>
                <input type="hidden" name="organisationId" value={draft.organisationId} />
                <input type="hidden" name="draftId" value={draft.id} />
                <input type="hidden" name="decision" value="changes" />
                <SubmitButton variant="secondary" size="sm">
                  Request Changes
                </SubmitButton>
              </form>

              <form action={decisionAction} onSubmit={() => setTimeout(() => router.refresh(), 500)}>
                <input type="hidden" name="organisationId" value={draft.organisationId} />
                <input type="hidden" name="draftId" value={draft.id} />
                <input type="hidden" name="decision" value="reject" />
                <SubmitButton variant="danger" size="sm">
                  Reject
                </SubmitButton>
              </form>
            </div>
          )}

          {/* Lead reopen review when locked */}
          {(draft.status === "approved" || draft.status === "rejected") && isLead && (
            <form action={reopenAction} onSubmit={() => setTimeout(() => router.refresh(), 500)}>
              <input type="hidden" name="organisationId" value={draft.organisationId} />
              <input type="hidden" name="draftId" value={draft.id} />
              <SubmitButton variant="secondary" size="sm">
                Reopen Review
              </SubmitButton>
            </form>
          )}

          {/* Archive / Restore draft */}
          {draft.status !== "archived" ? (
            <form action={archiveAction} onSubmit={() => setTimeout(() => router.refresh(), 500)}>
              <input type="hidden" name="organisationId" value={draft.organisationId} />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="isArchive" value="true" />
              <SubmitButton variant="ghost" size="sm" className="text-danger hover:bg-danger/10">
                <Trash2 className="h-4 w-4" />
              </SubmitButton>
            </form>
          ) : (
            <form action={archiveAction} onSubmit={() => setTimeout(() => router.refresh(), 500)}>
              <input type="hidden" name="organisationId" value={draft.organisationId} />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="isArchive" value="false" />
              <SubmitButton variant="secondary" size="sm">
                Restore Draft
              </SubmitButton>
            </form>
          )}

          {/* Version Diff compare link */}
          {versions.length > 1 && (
            <Link href={`/review/${draft.id}/compare`}>
              <Button variant="secondary" size="sm">
                <Eye className="mr-1.5 h-3.5 w-3.5" /> Compare Versions
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* 2. Split Workspace Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start h-full">
        {/* Left Side: Preview, Version List, Timeline (8 cols) */}
        <div className="flex flex-col gap-4 lg:col-span-8 h-full">
          {/* Tabs header */}
          <div className="flex gap-1 border-b border-border pb-px">
            <button
              onClick={() => setActiveLeftTab("preview")}
              className={cn(
                "pb-2 px-3 text-[13px] font-medium border-b-2 transition-colors",
                activeLeftTab === "preview"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Content Preview
            </button>
            <button
              onClick={() => setActiveLeftTab("versions")}
              className={cn(
                "pb-2 px-3 text-[13px] font-medium border-b-2 transition-colors",
                activeLeftTab === "versions"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Version History ({versions.length})
            </button>
            <button
              onClick={() => setActiveLeftTab("timeline")}
              className={cn(
                "pb-2 px-3 text-[13px] font-medium border-b-2 transition-colors",
                activeLeftTab === "timeline"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Audit Trail
            </button>
          </div>

          <div className="flex-1">
            {/* TAB: CONTENT PREVIEW */}
            {activeLeftTab === "preview" && (
              <div className="flex flex-col gap-4">
                <Card className="border border-border shadow-sm">
                  <CardHeader className="bg-muted/40 py-3.5 px-4 border-b border-border">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Live Document Content
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-5 flex flex-col gap-4 min-h-[350px]">
                    {draft.summary && (
                      <div className="bg-muted/30 rounded-lg p-3 border border-border">
                        <span className="block text-[11px] font-semibold text-subtle-foreground uppercase mb-1">
                          Brief / Summary
                        </span>
                        <p className="text-[13px] leading-relaxed text-foreground">{draft.summary}</p>
                      </div>
                    )}
                    <div className="flex-1">
                      <span className="block text-[11px] font-semibold text-subtle-foreground uppercase mb-2">
                        Draft Body
                      </span>
                      <div className="prose prose-sm dark:prose-invert max-w-none text-[13.5px] leading-relaxed whitespace-pre-wrap font-sans bg-card border border-border/80 rounded-lg p-4 min-h-[220px]">
                        {draft.body || <span className="text-muted-foreground italic">Draft body is empty.</span>}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Social media mockup preview if social_post */}
                {(draft.contentType === "social_post" || draft.contentType === "caption") && (
                  <Card className="border border-border shadow-sm bg-[#0f0f11] text-white">
                    <CardHeader className="py-3 px-4 border-b border-border/40">
                      <CardTitle className="text-xs font-semibold text-[#8b8e98] uppercase">
                        Mock Social Preview
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 flex justify-center">
                      {/* A beautiful dark-mode glassmorphic social preview box */}
                      <div className="w-full max-w-md border border-white/10 rounded-xl bg-white/5 p-4 shadow-xl">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-xs text-white">
                            V
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white">Villiz Social Manager</span>
                            <span className="block text-[10px] text-white/50">Draft Post Preview</span>
                          </div>
                        </div>
                        <p className="text-[12.5px] leading-relaxed text-white/90 whitespace-pre-wrap">
                          {draft.body || "Your post content will appear here..."}
                        </p>
                        <div className="mt-4 pt-3 border-t border-white/5 flex justify-between text-white/40 text-xs">
                          <span>❤️ Like</span>
                          <span>💬 Comment</span>
                          <span>🔁 Share</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* TAB: VERSION HISTORY */}
            {activeLeftTab === "versions" && (
              <div className="flex flex-col gap-3">
                {versions.map((ver) => (
                  <Card key={ver.id} className="border border-border/80 hover:border-border transition-all">
                    <CardContent className="p-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-bold text-foreground">Version {ver.version}</span>
                          <Badge tone="muted" className="text-[10px]">
                            {ver.status}
                          </Badge>
                          <span className="text-[11px] text-subtle-foreground">
                            {formatRelative(ver.createdAt)} by {ver.changedBy?.fullName || ver.changedBy?.email}
                          </span>
                        </div>
                        {ver.changeSummary && (
                          <p className="mt-1 text-[12px] text-foreground font-medium bg-muted/30 px-2 py-1 rounded border border-border/50">
                            📝 {ver.changeSummary}
                          </p>
                        )}
                        {/* Summary of changes in body */}
                        <div className="mt-2 text-[12px] text-subtle-foreground line-clamp-2 bg-card/60 p-2.5 rounded border border-border/40 font-mono overflow-hidden">
                          {ver.body}
                        </div>
                      </div>

                      {/* Restore / Duplicate buttons */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <form
                          action={async (fd) => {
                            const res = await restoreVersionAction(idleState, fd);
                            handleActionComplete(res, "Version restored.");
                          }}
                        >
                          <input type="hidden" name="organisationId" value={draft.organisationId} />
                          <input type="hidden" name="draftId" value={draft.id} />
                          <input type="hidden" name="versionNumber" value={ver.version} />
                           <Button variant="secondary" size="sm" className="h-8 gap-1.5">
                            <RotateCcw className="h-3.5 w-3.5" /> Restore
                          </Button>
                        </form>

                        <form
                          action={async (fd) => {
                            const res = await duplicateVersionAction(idleState, fd);
                            handleActionComplete(res, "Draft duplicated.");
                          }}
                        >
                          <input type="hidden" name="organisationId" value={draft.organisationId} />
                          <input type="hidden" name="draftId" value={draft.id} />
                          <input type="hidden" name="versionNumber" value={ver.version} />
                          <Button variant="secondary" size="sm" className="h-8 gap-1.5">
                            <Copy className="h-3.5 w-3.5" /> Copy
                          </Button>
                        </form>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* TAB: AUDIT TRAIL */}
            {activeLeftTab === "timeline" && (
              <Card className="border border-border/80 shadow-sm">
                <CardContent className="p-5">
                  <div className="flow-root">
                    <ul className="-mb-8">
                      {auditLogs.map((log, logIdx) => (
                        <li key={log.id}>
                          <div className="relative pb-8">
                            {logIdx !== auditLogs.length - 1 ? (
                              <span
                                className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-border"
                                aria-hidden="true"
                              />
                            ) : null}
                            <div className="relative flex space-x-3">
                              <div>
                                <span className="h-8 w-8 rounded-full bg-muted border border-border flex items-center justify-center">
                                  <History className="h-4 w-4 text-subtle-foreground" />
                                </span>
                              </div>
                              <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                                <div>
                                  <p className="text-xs text-foreground font-medium">{log.description}</p>
                                  <span className="block text-[10px] text-subtle-foreground mt-0.5">
                                    By {log.actor?.fullName || log.actor?.email || "System"}
                                  </span>
                                </div>
                                <div className="text-right text-[10px] whitespace-nowrap text-subtle-foreground">
                                  <time dateTime={log.createdAt}>{formatRelative(log.createdAt)}</time>
                                </div>
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right Side: Metadata Panel & Comments Thread (4 cols) */}
        <div className="flex flex-col gap-4 lg:col-span-4 h-full">
          {/* Tabs header */}
          <div className="flex gap-1 border-b border-border pb-px">
            <button
              onClick={() => setActiveRightTab("comments")}
              className={cn(
                "pb-2 px-3 text-[13px] font-medium border-b-2 transition-colors",
                activeRightTab === "comments"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Comments ({comments.length})
            </button>
            <button
              onClick={() => setActiveRightTab("meta")}
              className={cn(
                "pb-2 px-3 text-[13px] font-medium border-b-2 transition-colors",
                activeRightTab === "meta"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Settings & Reviewers
            </button>
          </div>

          <div className="flex-1">
            {/* TAB: COMMENTS */}
            {activeRightTab === "comments" && (
              <div className="flex flex-col gap-4">
                {/* Render comment threads recursively */}
                <div className="flex flex-col gap-4 max-h-[500px] overflow-y-auto pr-1">
                  {comments.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-border rounded-lg bg-card/40">
                      <MessageSquare className="mx-auto h-8 w-8 text-subtle-foreground mb-2" aria-hidden />
                      <p className="text-[13px] font-medium text-foreground">No comments yet</p>
                      <p className="text-[11px] text-subtle-foreground">Start a conversation or ask for changes.</p>
                    </div>
                  ) : (
                    comments.map((thread) => (
                      <div key={thread.id} className="flex flex-col gap-2 bg-card p-3.5 rounded-lg border border-border shadow-xs">
                        {/* Root Comment content */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-muted border border-border flex items-center justify-center font-bold text-[10px] text-foreground">
                              {thread.author?.fullName?.[0] || thread.author?.email?.[0] || "?"}
                            </div>
                            <div>
                              <span className="block text-xs font-semibold text-foreground">
                                {thread.author?.fullName || thread.author?.email}
                              </span>
                              <span className="block text-[9px] text-subtle-foreground">
                                {formatRelative(thread.createdAt)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {/* Resolve comment thread checkbox */}
                            {!thread.isResolved ? (
                              <form
                                action={async (fd) => {
                                  const res = await resolveCommentAction(idleState, fd);
                                  handleActionComplete(res, "Comment resolved.");
                                }}
                              >
                                <input type="hidden" name="organisationId" value={draft.organisationId} />
                                <input type="hidden" name="commentId" value={thread.id} />
                                <input type="hidden" name="draftId" value={draft.id} />
                                <Button type="submit" variant="ghost" size="sm" className="h-6 text-[10px] text-success hover:bg-success/10 py-0 px-1.5">
                                  Resolve
                                </Button>
                              </form>
                            ) : (
                              <form
                                action={async (fd) => {
                                  const res = await reopenCommentAction(idleState, fd);
                                  handleActionComplete(res, "Comment reopened.");
                                }}
                              >
                                <input type="hidden" name="organisationId" value={draft.organisationId} />
                                <input type="hidden" name="commentId" value={thread.id} />
                                <input type="hidden" name="draftId" value={draft.id} />
                                <Button type="submit" variant="ghost" size="sm" className="h-6 text-[10px] text-muted hover:bg-muted py-0 px-1.5">
                                  Reopen
                                </Button>
                              </form>
                            )}
                          </div>
                        </div>

                        {/* Edit comment block or text view */}
                        {editingCommentId === thread.id ? (
                          <form
                            action={async (fd) => {
                              const res = await updateCommentAction(idleState, fd);
                              if (res.status === "success") {
                                setEditingCommentId(null);
                                handleActionComplete(res, "Comment updated.");
                              }
                            }}
                            className="mt-1 flex flex-col gap-1.5"
                          >
                            <input type="hidden" name="organisationId" value={draft.organisationId} />
                            <input type="hidden" name="commentId" value={thread.id} />
                            <input type="hidden" name="draftId" value={draft.id} />
                            <textarea
                              name="body"
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              className="w-full text-xs p-2 rounded border border-border bg-card resize-none min-h-[60px]"
                            />
                            <div className="flex justify-end gap-1.5">
                              <Button type="button" variant="secondary" size="sm" onClick={() => setEditingCommentId(null)}>
                                Cancel
                              </Button>
                              <Button type="submit" variant="primary" size="sm">
                                Save
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <div className={cn("text-xs leading-relaxed text-foreground mt-1", thread.isResolved && "line-through text-subtle-foreground")}>
                            {thread.body}
                          </div>
                        )}

                        {/* Root comment action footer */}
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-subtle-foreground border-t border-border/40 pt-1.5">
                          <button
                            onClick={() => {
                              setReplyParentId(thread.id);
                              setReplyBody("");
                            }}
                            className="hover:text-foreground transition-colors"
                          >
                            Reply
                          </button>
                          {thread.author?.id === actorId && (
                            <button
                              onClick={() => {
                                setEditingCommentId(thread.id);
                                setEditBody(thread.body);
                              }}
                              className="hover:text-foreground transition-colors"
                            >
                              Edit
                            </button>
                          )}
                        </div>

                        {/* Nested Replies list */}
                        {thread.replies && thread.replies.length > 0 && (
                          <div className="mt-2.5 pl-4 border-l-2 border-border/60 flex flex-col gap-2.5">
                            {thread.replies.map((reply) => (
                              <div key={reply.id} className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                  <div className="h-5 w-5 rounded-full bg-muted border border-border flex items-center justify-center font-bold text-[8px] text-foreground">
                                    {reply.author?.fullName?.[0] || reply.author?.email?.[0] || "?"}
                                  </div>
                                  <div>
                                    <span className="text-[11px] font-semibold text-foreground">
                                      {reply.author?.fullName || reply.author?.email}
                                    </span>
                                    <span className="text-[8px] text-subtle-foreground ml-1.5">
                                      {formatRelative(reply.createdAt)}
                                    </span>
                                  </div>
                                </div>

                                {editingCommentId === reply.id ? (
                                  <form
                                    action={async (fd) => {
                                      const res = await updateCommentAction(idleState, fd);
                                      if (res.status === "success") {
                                        setEditingCommentId(null);
                                        handleActionComplete(res, "Comment updated.");
                                      }
                                    }}
                                    className="mt-1 flex flex-col gap-1.5"
                                  >
                                    <input type="hidden" name="organisationId" value={draft.organisationId} />
                                    <input type="hidden" name="commentId" value={reply.id} />
                                    <input type="hidden" name="draftId" value={draft.id} />
                                    <textarea
                                      name="body"
                                      value={editBody}
                                      onChange={(e) => setEditBody(e.target.value)}
                                      className="w-full text-xs p-2 rounded border border-border bg-card resize-none min-h-[50px]"
                                    />
                                    <div className="flex justify-end gap-1.5">
                                      <Button type="button" variant="secondary" size="sm" onClick={() => setEditingCommentId(null)}>
                                        Cancel
                                      </Button>
                                      <Button type="submit" variant="primary" size="sm">
                                        Save
                                      </Button>
                                    </div>
                                  </form>
                                ) : (
                                  <p className="text-xs text-foreground leading-relaxed pl-6">
                                    {reply.body}
                                  </p>
                                )}

                                {reply.author?.id === actorId && editingCommentId !== reply.id && (
                                  <button
                                    onClick={() => {
                                      setEditingCommentId(reply.id);
                                      setEditBody(reply.body);
                                    }}
                                    className="text-[9px] text-subtle-foreground hover:text-foreground self-start pl-6 mt-0.5"
                                  >
                                    Edit
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Inline reply textbox */}
                        {replyParentId === thread.id && (
                          <form
                            action={async (fd) => {
                              const res = await createCommentAction(idleState, fd);
                              if (res.status === "success") {
                                setReplyParentId(null);
                                setReplyBody("");
                                handleActionComplete(res, "Reply added.");
                              }
                            }}
                            className="mt-2.5 flex items-center gap-2 border-t border-border/30 pt-2.5"
                          >
                            <input type="hidden" name="organisationId" value={draft.organisationId} />
                            <input type="hidden" name="draftId" value={draft.id} />
                            <input type="hidden" name="parentId" value={thread.id} />
                            <input
                              type="text"
                              name="body"
                              placeholder="Write a reply..."
                              value={replyBody}
                              onChange={(e) => setReplyBody(e.target.value)}
                              className="flex-1 text-xs px-2.5 py-1.5 rounded border border-border bg-card h-8"
                            />
                            <div className="flex items-center gap-1">
                              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setReplyParentId(null)}>
                                Cancel
                              </Button>
                              <Button type="submit" variant="primary" size="sm" className="h-8">
                                Reply
                              </Button>
                            </div>
                          </form>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Add comment input */}
                <Card className="border border-border">
                  <CardContent className="p-3">
                    <form
                      action={async (fd) => {
                        const res = await createCommentAction(idleState, fd);
                        if (res.status === "success") {
                          const bodyTextarea = document.getElementById("newCommentBody") as HTMLTextAreaElement;
                          if (bodyTextarea) bodyTextarea.value = "";
                          handleActionComplete(res, "Comment added.");
                        }
                      }}
                      className="flex flex-col gap-2"
                    >
                      <input type="hidden" name="organisationId" value={draft.organisationId} />
                      <input type="hidden" name="draftId" value={draft.id} />
                      <textarea
                        id="newCommentBody"
                        name="body"
                        placeholder="Type a comment or request changes..."
                        required
                        className="w-full text-xs p-2.5 rounded border border-border bg-card resize-none min-h-[70px] outline-none focus:border-primary"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-subtle-foreground">
                          Comments update the timeline instantly
                        </span>
                        <Button type="submit" variant="primary" size="sm" className="gap-1">
                          <Send className="h-3 w-3" /> Post Comment
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* TAB: METADATA & SETTINGS */}
            {activeRightTab === "meta" && (
              <div className="flex flex-col gap-4">
                {/* 1. Priority & Deadline Editor Form */}
                <Card className="border border-border">
                  <CardHeader className="py-3 px-4 border-b border-border bg-muted/40">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" /> Priority & Deadline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <form
                      action={async (fd) => {
                        const res = await updatePriorityAndDeadlineAction(idleState, fd);
                        handleActionComplete(res, "Settings updated.");
                      }}
                      className="flex flex-col gap-4"
                    >
                      <input type="hidden" name="organisationId" value={draft.organisationId} />
                      <input type="hidden" name="draftId" value={draft.id} />

                      {/* Priority selector */}
                      <div>
                        <label className="block text-[11px] font-semibold text-subtle-foreground uppercase mb-1.5">
                          Review Priority
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {["low", "medium", "high"].map((p) => (
                            <label
                              key={p}
                              className={cn(
                                "flex items-center justify-center px-3 py-2 border rounded-lg text-xs font-medium cursor-pointer capitalize transition-all select-none",
                                draft.priority === p
                                  ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                                  : "border-border bg-card text-muted-foreground hover:bg-card-hover"
                              )}
                            >
                              <input
                                type="radio"
                                name="priority"
                                value={p}
                                defaultChecked={draft.priority === p}
                                className="sr-only"
                              />
                              {p}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Deadline Picker */}
                      <div>
                        <label htmlFor="reviewDeadline" className="block text-[11px] font-semibold text-subtle-foreground uppercase mb-1.5">
                          Review Deadline
                        </label>
                        <div className="relative">
                          <input
                            type="date"
                            id="reviewDeadline"
                            name="reviewDeadline"
                            defaultValue={draft.reviewDeadline ? draft.reviewDeadline.split("T")[0] : ""}
                            className="w-full text-xs pl-9 pr-3 py-2 border border-border rounded-lg bg-card focus:border-primary outline-none"
                          />
                          <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-subtle-foreground pointer-events-none" />
                        </div>
                      </div>

                      <Button type="submit" variant="primary" size="sm" className="w-full">
                        Save Settings
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {/* 2. Assigned Reviewer Selector Form */}
                <Card className="border border-border">
                  <CardHeader className="py-3 px-4 border-b border-border bg-muted/40">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground flex items-center gap-2">
                      <UserPlus className="h-4 w-4" /> Assigned Reviewer
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <form
                      action={async (fd) => {
                        const res = await assignReviewerAction(idleState, fd);
                        handleActionComplete(res, "Reviewer assigned.");
                      }}
                      className="flex flex-col gap-3"
                    >
                      <input type="hidden" name="organisationId" value={draft.organisationId} />
                      <input type="hidden" name="draftId" value={draft.id} />

                      <div>
                        <label htmlFor="reviewerId" className="block text-[11px] font-semibold text-subtle-foreground uppercase mb-1.5">
                          Select Reviewer
                        </label>
                        <select
                          id="reviewerId"
                          name="reviewerId"
                          defaultValue={draft.assignedReviewer?.id || ""}
                          className="w-full text-xs px-3 py-2 border border-border rounded-lg bg-card focus:border-primary outline-none"
                        >
                          <option value="">-- No Reviewer Assigned --</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.fullName || m.email}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button type="submit" variant="primary" size="sm" className="w-full">
                        Assign Reviewer
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
