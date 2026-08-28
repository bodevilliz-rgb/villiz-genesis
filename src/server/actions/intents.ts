"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/server/container";
import { canWriteContent } from "@/core/domain/entities/identity";
import { INTENT_CONSENT_STATUSES, INTENT_SOURCES, INTENT_STAGES, normaliseIntentService } from "@/core/domain/entities/intent";
import { routes } from "@/lib/routes";

const optionalText = (maximum: number) => z.preprocess(
  (value) => typeof value === "string" && value.trim() ? value.trim() : null,
  z.string().min(2).max(maximum).nullable(),
);

export async function createIntentSignalAction(formData: FormData) {
  const parsed = z.object({
    organisationId: z.string().uuid(),
    serviceLabel: z.string().trim().min(2).max(120),
    locality: optionalText(120),
    desiredTimeframe: optionalText(120),
    source: z.enum(INTENT_SOURCES),
    stage: z.enum(INTENT_STAGES),
    consentStatus: z.enum(INTENT_CONSENT_STATUSES),
    occurredAt: z.string().datetime({ offset: true }),
  }).parse({
    organisationId: formData.get("organisationId"),
    serviceLabel: formData.get("serviceLabel"),
    locality: formData.get("locality"),
    desiredTimeframe: formData.get("desiredTimeframe"),
    source: formData.get("source"),
    stage: formData.get("stage"),
    consentStatus: formData.get("consentStatus"),
    occurredAt: formData.get("occurredAt"),
  });

  const context = await requireContext();
  const role = await context.organisations.viewerRole(parsed.organisationId);
  if (!canWriteContent(context.actor, role)) throw new Error("You do not have permission to record customer intent.");

  const serviceKey = normaliseIntentService(parsed.serviceLabel);
  if (!serviceKey) throw new Error("Enter a valid service.");

  await context.intents.create({
    ...parsed,
    serviceKey,
    createdBy: context.actor.id,
  });
  revalidatePath(routes.organisations.intent(parsed.organisationId));
}
