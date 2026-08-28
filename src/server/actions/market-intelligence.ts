"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/server/container";
import { routes } from "@/lib/routes";
import { canWriteContent } from "@/core/domain/entities/identity";
import { BUSINESS_OBJECTIVES, CULTURAL_VOICE_LEVELS, PATTERN_CATEGORIES } from "@/core/domain/entities/market-intelligence";

const list = (value: FormDataEntryValue | null) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
async function writable(organisationId: string) { const context = await requireContext(); const role = await context.organisations.viewerRole(organisationId); if (!canWriteContent(context.actor, role)) throw new Error("You do not have permission to edit Market Intelligence."); return context; }

export async function saveMarketProfileAction(formData: FormData) {
  const organisationId = z.string().uuid().parse(formData.get("organisationId"));
  const context = await writable(organisationId);
  const objectives = list(formData.get("businessObjectives")).filter((value): value is (typeof BUSINESS_OBJECTIVES)[number] => BUSINESS_OBJECTIVES.includes(value as never));
  const voice = z.enum(CULTURAL_VOICE_LEVELS).parse(formData.get("culturalVoiceLevel"));
  await context.marketIntelligence.upsertProfile({ organisationId, businessObjectives: objectives, targetGeographies: list(formData.get("targetGeographies")), serviceAreas: list(formData.get("serviceAreas")), audienceContext: String(formData.get("audienceContext") || "").trim() || null, culturalContext: String(formData.get("culturalContext") || "").trim() || null, promotionalFocus: String(formData.get("promotionalFocus") || "").trim() || null, culturalVoiceLevel: voice, conversionActions: list(formData.get("conversionActions")), platformStrategy: Object.fromEntries(["instagram", "facebook", "linkedin", "x", "tiktok"].map((platform) => [platform, String(formData.get(`${platform}PlatformStrategy`) || "").trim()]).filter(([, value]) => value)), hashtagStrategy: { local: String(formData.get("localStrategy") || "").trim(), service: String(formData.get("serviceStrategy") || "").trim(), audience_cultural: String(formData.get("audienceStrategy") || "").trim(), occasion_topic: String(formData.get("occasionStrategy") || "").trim(), campaign: String(formData.get("campaignStrategy") || "").trim(), brand: String(formData.get("brandStrategy") || "").trim() } });
  revalidatePath(routes.organisations.marketIntelligence(organisationId));
  redirect(`${routes.organisations.marketIntelligence(organisationId)}?saved=1`);
}

export async function addMarketReferenceAction(formData: FormData) {
  const organisationId = z.string().uuid().parse(formData.get("organisationId")); const context = await writable(organisationId);
  await context.marketIntelligence.createReference({ organisationId, identifier: z.string().trim().min(1).max(160).parse(formData.get("identifier")), platform: z.string().trim().min(1).max(40).parse(formData.get("platform")), market: String(formData.get("market") || "").trim() || null, vertical: String(formData.get("vertical") || "").trim() || null, relevanceNote: z.string().trim().min(1).max(1000).parse(formData.get("relevanceNote")), sourceUrl: String(formData.get("sourceUrl") || "").trim() || null, isActive: true, reviewedAt: null });
  revalidatePath(routes.organisations.marketIntelligence(organisationId));
}

export async function addMarketPatternAction(formData: FormData) {
  const organisationId = z.string().uuid().parse(formData.get("organisationId")); const context = await writable(organisationId);
  const observation = z.string().trim().min(20).max(1000).parse(formData.get("observation"));
  if (/(full caption|verbatim caption|copy this caption)/i.test(observation)) throw new Error("Store an abstract observation, not competitor copy.");
  await context.marketIntelligence.createPattern({ organisationId, observation, category: z.enum(PATTERN_CATEGORIES).parse(formData.get("category")), platform: String(formData.get("platform") || "").trim() || null, market: String(formData.get("market") || "").trim() || null, vertical: String(formData.get("vertical") || "").trim() || null, provenance: z.string().trim().min(3).max(500).parse(formData.get("provenance")), sourceUrl: String(formData.get("sourceUrl") || "").trim() || null, confidence: Math.min(100, Math.max(0, Number(formData.get("confidence") || 50))), observedAt: null, reviewedAt: new Date().toISOString(), isActive: true });
  revalidatePath(routes.organisations.marketIntelligence(organisationId));
}
