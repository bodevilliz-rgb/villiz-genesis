import { z } from "zod";
import { contentDraftStatusSchema } from "@/core/application/dto/content-dto";

export const submitForReviewSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
});

export const assignReviewerSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  reviewerId: z.string().uuid(),
});

const commentSchema = z.string().trim().max(2000);

export const approveDraftSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  comment: commentSchema.optional().or(z.literal("")),
});

export const requestDraftChangesSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  comment: commentSchema.min(3, "Explain what needs to change before sending this back."),
});

export const rejectDraftSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  comment: commentSchema.min(3, "Explain why this draft is being rejected."),
});

export const reopenReviewSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  comment: commentSchema.optional().or(z.literal("")),
});

export const listReviewQueueSchema = z.object({
  organisationId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  status: contentDraftStatusSchema.optional(),
  assignedReviewerId: z.string().uuid().optional(),
  authorId: z.string().uuid().optional(),
  submittedFrom: z.string().optional(),
  submittedTo: z.string().optional(),
});

export type SubmitForReviewInput = z.infer<typeof submitForReviewSchema>;
export type AssignReviewerInput = z.infer<typeof assignReviewerSchema>;
export type ApproveDraftInput = z.infer<typeof approveDraftSchema>;
export type RequestDraftChangesInput = z.infer<typeof requestDraftChangesSchema>;
export type RejectDraftInput = z.infer<typeof rejectDraftSchema>;
export type ReopenReviewInput = z.infer<typeof reopenReviewSchema>;
export type ListReviewQueueInput = z.infer<typeof listReviewQueueSchema>;
