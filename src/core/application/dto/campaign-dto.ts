import { z } from "zod";

export const campaignStatusSchema = z.enum(["planning", "active", "completed", "archived"]);
export const campaignPlatformSchema = z.enum([
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
  "pinterest",
  "threads",
]);

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .optional()
  .or(z.literal(""));

const baseCampaignFields = {
  name: z.string().trim().min(2, "Give the campaign a name of at least 2 characters").max(200),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  objective: z.string().trim().max(500).optional().or(z.literal("")),
  targetAudience: z.string().trim().max(1000).optional().or(z.literal("")),
  primaryCTA: z.string().trim().max(300).optional().or(z.literal("")),
  startDate: isoDate,
  endDate: isoDate,
  status: campaignStatusSchema.default("planning"),
  platforms: z.array(campaignPlatformSchema).max(8).default([]),
  successMetric: z.string().trim().max(300).optional().or(z.literal("")),

  // Sprint 2 campaign fields
  client: z.string().trim().max(200).optional().or(z.literal("")),
  brand: z.string().trim().max(200).optional().or(z.literal("")),
  campaignType: z.string().trim().max(200).optional().or(z.literal("")),
  ownerId: z.string().uuid().optional().or(z.literal("")),
  teamMembers: z.array(z.string().uuid()).optional().default([]),
  colorLabel: z.string().trim().max(50).optional().or(z.literal("")),
  tags: z.array(z.string()).optional().default([]),
  priority: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  assets: z.array(z.any()).optional().default([]),
};

/** Shared by create/update — kept as a plain function (not a generic schema
 * wrapper) so zod retains each schema's concrete key shape; a generic
 * `<T extends ZodTypeAny>` wrapper was tried first and widened
 * `.flatten().fieldErrors` to an unknown-keys shape at every call site. */
function checkDateOrder(value: { startDate?: string; endDate?: string }, ctx: z.RefinementCtx) {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "End date cannot be before the start date",
    });
  }
}

export const createCampaignSchema = z
  .object({
    organisationId: z.string().uuid(),
    ...baseCampaignFields,
  })
  .superRefine(checkDateOrder);

export const updateCampaignSchema = z
  .object({
    id: z.string().uuid(),
    organisationId: z.string().uuid(),
    ...baseCampaignFields,
  })
  .superRefine(checkDateOrder);

export const archiveCampaignSchema = z.object({
  organisationId: z.string().uuid(),
  campaignId: z.string().uuid(),
});

export const listCampaignsSchema = z.object({
  organisationId: z.string().uuid(),
  query: z.string().trim().max(200).optional(),
  status: campaignStatusSchema.optional(),
  platform: campaignPlatformSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type ArchiveCampaignInput = z.infer<typeof archiveCampaignSchema>;
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;
