import { z } from "zod";

const hexColour = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, for example #FF6A1F");

export const organisationStatusSchema = z.enum(["prospect", "active", "paused", "offboarded"]);
export const organisationRoleSchema = z.enum(["lead", "contributor", "reviewer"]);

export const createOrganisationSchema = z.object({
  name: z.string().trim().min(2, "Give the client a name of at least 2 characters").max(120),
  legalName: z.string().trim().max(160).optional().or(z.literal("")),
  industry: z.string().trim().max(80).optional().or(z.literal("")),
  websiteUrl: z.string().trim().url("Enter a full URL including https://").optional().or(z.literal("")),
  status: organisationStatusSchema.default("prospect"),
  brandColour: hexColour.optional().or(z.literal("")),
  primaryContactName: z.string().trim().max(120).optional().or(z.literal("")),
  primaryContactEmail: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
});

export const updateOrganisationSchema = createOrganisationSchema.extend({
  id: z.string().uuid(),
});

export const assignMemberSchema = z.object({
  organisationId: z.string().uuid(),
  profileId: z.string().uuid(),
  role: organisationRoleSchema,
});

export const removeMemberSchema = z.object({
  organisationId: z.string().uuid(),
  profileId: z.string().uuid(),
});

export const updateLimitsSchema = z.object({
  organisationId: z.string().uuid(),
  maxSocialAccounts: z.coerce.number().int().min(0).max(500),
  maxPostsPerWeek: z.coerce.number().int().min(0).max(5000),
  maxStorageGb: z.coerce.number().min(0).max(5000),
  maxAiTokensPerMonth: z.coerce.number().int().min(0).max(1000000000),
  maxMembrainEntries: z.coerce.number().int().min(0).max(1000000),
});

export type CreateOrganisationInput = z.infer<typeof createOrganisationSchema>;
export type UpdateOrganisationInput = z.infer<typeof updateOrganisationSchema>;
export type AssignMemberInput = z.infer<typeof assignMemberSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
export type UpdateLimitsInput = z.infer<typeof updateLimitsSchema>;
