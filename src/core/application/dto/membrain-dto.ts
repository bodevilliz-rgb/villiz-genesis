import { z } from "zod";

export const membrainStatusSchema = z.enum(["draft", "active", "archived"]);
export const membrainSourceSchema = z.enum([
  "manual",
  "client_brief",
  "discovery_call",
  "performance_insight",
  "competitor_research",
  "published_asset",
]);

export const createEntrySchema = z.object({
  organisationId: z.string().uuid(),
  title: z.string().trim().min(3, "Titles need at least 3 characters").max(200),
  summary: z.string().trim().max(500, "Keep the summary under 500 characters").optional().or(z.literal("")),
  body: z.string().trim().min(1, "Write the knowledge itself — this is what the AI reads").max(50000),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  status: membrainStatusSchema.default("active"),
  source: membrainSourceSchema.default("manual"),
  sourceUrl: z.string().trim().url("Enter a full URL including https://").optional().or(z.literal("")),
  importance: z.coerce.number().int().min(1).max(5).default(3),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export const updateEntrySchema = createEntrySchema.extend({
  id: z.string().uuid(),
  changeSummary: z.string().trim().max(280).optional().or(z.literal("")),
});

export const searchEntriesSchema = z.object({
  organisationId: z.string().uuid(),
  query: z.string().trim().max(200).optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  statuses: z.array(membrainStatusSchema).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const retrieveContextSchema = z.object({
  organisationId: z.string().uuid(),
  query: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  maxCharacters: z.coerce.number().int().min(500).max(120000).default(24000),
  recordUsage: z.boolean().default(true),
});

export const restoreVersionSchema = z.object({
  organisationId: z.string().uuid(),
  entryId: z.string().uuid(),
  version: z.coerce.number().int().min(1),
});

export const archiveEntrySchema = z.object({
  organisationId: z.string().uuid(),
  entryId: z.string().uuid(),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type SearchEntriesInput = z.infer<typeof searchEntriesSchema>;
export type RetrieveContextInput = z.infer<typeof retrieveContextSchema>;
export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>;
