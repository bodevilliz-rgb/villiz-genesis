import { z } from "zod";

export const contentDraftStatusSchema = z.enum(["draft", "needs_review", "approved", "rejected"]);
export const contentDraftTypeSchema = z.enum([
  "social_post",
  "email",
  "blog_article",
  "ad_copy",
  "video_script",
  "other",
]);

export const createDraftSchema = z.object({
  organisationId: z.string().uuid(),
  title: z.string().trim().min(3, "Titles need at least 3 characters").max(200),
  contentType: contentDraftTypeSchema.default("social_post"),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  campaignId: z.string().uuid().optional().or(z.literal("")),
  summary: z.string().trim().max(500, "Keep the summary under 500 characters").optional().or(z.literal("")),
  body: z.string().max(50000).optional().or(z.literal("")),
});

export const updateDraftSchema = createDraftSchema.extend({
  id: z.string().uuid(),
  changeSummary: z.string().trim().max(280).optional().or(z.literal("")),
});

export const listDraftsSchema = z.object({
  organisationId: z.string().uuid(),
  query: z.string().trim().max(200).optional(),
  status: contentDraftStatusSchema.optional(),
  contentType: contentDraftTypeSchema.optional(),
  categoryId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  authorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createGenerationRequestSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  brief: z.string().trim().min(3, "Describe what you need in a little more detail").max(4000),
  targetAudience: z.string().trim().max(300).optional().or(z.literal("")),
  tone: z.string().trim().max(100).optional().or(z.literal("")),
  contentPillarCategoryId: z.string().uuid().optional().or(z.literal("")),
});

export type CreateDraftInput = z.infer<typeof createDraftSchema>;
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
export type ListDraftsInput = z.infer<typeof listDraftsSchema>;
export type CreateGenerationRequestInput = z.infer<typeof createGenerationRequestSchema>;
