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
  confidence: z.number().int().min(0).max(100),
});

export type GenerateEngagementRecommendationInput = z.infer<typeof generateEngagementRecommendationSchema>;
export type EngagementRecommendationModelOutput = z.infer<typeof engagementRecommendationModelSchema>;
