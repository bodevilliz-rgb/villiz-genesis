import { z } from "zod";

export const engagementPlatformSchema = z.enum([
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
  "pinterest",
  "threads",
]);

export const generateEngagementRecommendationSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  platform: engagementPlatformSchema,
  objectiveType: z.enum(["awareness", "engagement", "enquiries", "bookings"]).default("engagement"),
  objective: z.string().trim().max(300).optional().or(z.literal("")),
});

const hashtagSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^#[\p{L}\p{N}_]+$/u, "Hashtags must begin with # and contain only letters, numbers or underscores");

export const engagementRecommendationModelSchema = z.object({
  recommendedCaption: z.string().trim().min(1).max(5000),
  alternativeCaptions: z.array(z.string().trim().min(1).max(5000)).min(1).max(2),
  hook: z.string().trim().min(1).max(500),
  cta: z.string().trim().min(1).max(500),
  hashtags: z.object({
    brand: z.array(hashtagSchema).max(5),
    local: z.array(hashtagSchema).max(5),
    service: z.array(hashtagSchema).max(5),
    audience: z.array(hashtagSchema).max(5),
  }),
  rationale: z.string().trim().min(1).max(2000),
  predictedStrengths: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
  limitations: z.array(z.string().trim().min(1).max(500)).max(5),
  creativeGuidance: z.object({
    mediaBasis: z.enum(["metadata_only", "none"]),
    visualHook: z.string().trim().min(1).max(500),
    formatRecommendation: z.string().trim().min(1).max(500),
    shareTrigger: z.string().trim().min(1).max(500),
    saveTrigger: z.string().trim().min(1).max(500),
    accessibilityNote: z.string().trim().min(1).max(500),
  }),
  confidence: z.number().int().min(0).max(100),
});

export const recordEngagementFeedbackSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  recommendationId: z.string().uuid(),
  action: z.enum(["selected", "dismissed"]),
  variant: z.enum(["recommended", "alternative_1", "alternative_2", "custom"]).nullable(),
  captionSnapshot: z.string().trim().max(5000).nullable(),
  hashtagSnapshot: z.array(z.string().trim().max(80)).max(20).default([]),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const applyEngagementRecommendationSchema = recordEngagementFeedbackSchema.extend({
  action: z.literal("selected"),
  variant: z.enum(["recommended", "alternative_1", "alternative_2", "custom"]),
  captionSnapshot: z.string().trim().min(1).max(5000),
});

export const recordCommercialOutcomeSchema = z.object({
  organisationId: z.string().uuid(),
  draftId: z.string().uuid(),
  platform: engagementPlatformSchema,
  enquiries: z.number().int().min(0).max(100000),
  bookings: z.number().int().min(0).max(100000),
  revenueMinor: z.number().int().min(0).max(1_000_000_000),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  note: z.string().trim().max(500).nullable().optional(),
});

export type GenerateEngagementRecommendationInput = z.infer<typeof generateEngagementRecommendationSchema>;
export type EngagementRecommendationModelOutput = z.infer<typeof engagementRecommendationModelSchema>;
