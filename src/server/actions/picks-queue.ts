"use server";

import { revalidatePath } from "next/cache";

import { retrieveContext } from "@/core/application/use-cases/membrain";
import {
  buildPickCaptionOptions,
  verifyNativePostUrl,
} from "@/core/application/use-cases/picks-queue";
import {
  createImmediatePublishingJob,
  createScheduledPublishingJob,
} from "@/core/application/use-cases/publishing";
import {
  isPublishingPlatform,
  type PublishingPlatform,
} from "@/core/domain/entities/publishing";
import type { PicksQueueItemRow } from "@/infrastructure/supabase/database.types";
import { blotatoConfig } from "@/infrastructure/blotato/blotato-config";
import { queueMervicPublishAlert } from "@/infrastructure/alerts/twilio-mervic-alert";
import { routes } from "@/lib/routes";
import { errorState, successState, textOrEmpty, type ActionState } from "../action-result";
import { requireContext } from "../container";

function publishingDeps(context: Awaited<ReturnType<typeof requireContext>>) {
  return {
    actor: context.actor,
    publishing: context.publishing,
    blotatoAccounts: context.blotatoAccounts,
    content: context.content,
    organisations: context.organisations,
    audits: context.audits,
    notifications: context.notifications,
    engagement: context.engagement,
  };
}

async function loadPick(
  context: Awaited<ReturnType<typeof requireContext>>,
  organisationId: string,
  pickId: string,
): Promise<PicksQueueItemRow> {
  const { data, error } = await context.client
    .from("picks_queue_items")
    .select()
    .eq("organisation_id", organisationId)
    .eq("id", pickId)
    .single();
  if (error || !data) throw new Error("Pick not found or no longer available.");
  return data;
}

function storedCaptionOptions(value: PicksQueueItemRow["caption_options"]): string[] {
  return Array.isArray(value) ? value.filter((option): option is string => typeof option === "string" && option.trim() !== "") : [];
}

async function resolveApprovedCaption(
  context: Awaited<ReturnType<typeof requireContext>>,
  pick: PicksQueueItemRow,
  caption: string,
): Promise<string> {
  const pack = await retrieveContext(
    { actor: context.actor, membrain: context.membrain, organisations: context.organisations },
    { organisationId: pick.organisation_id, query: "social post caption brand voice audience", limit: 12, maxCharacters: 24000, recordUsage: false },
  );
  const allowed = [
    ...storedCaptionOptions(pick.caption_options),
    ...buildPickCaptionOptions({ itemLabel: pick.item_label, context: pack.items }),
  ];
  const selected = caption.trim();
  if (!allowed.includes(selected)) throw new Error("Choose one of the current MemBrain-grounded caption options.");
  return selected;
}

async function preparePick(
  context: Awaited<ReturnType<typeof requireContext>>,
  pick: PicksQueueItemRow,
  platform: PublishingPlatform,
  caption: string,
): Promise<string> {
  const { data, error } = await context.client.rpc("prepare_pick_for_publishing", {
    p_organisation_id: pick.organisation_id,
    p_pick_id: pick.id,
    p_caption: caption,
    p_platform: platform,
    p_actor_id: context.actor.id,
  });
  if (error || typeof data !== "string") throw new Error(error?.message ?? "The pick could not be prepared.");
  return data;
}

function parseCommon(formData: FormData): {
  organisationId: string;
  pickId: string;
  platform: PublishingPlatform;
  caption: string;
} {
  const organisationId = textOrEmpty(formData, "organisationId");
  const pickId = textOrEmpty(formData, "pickId");
  const platformRaw = textOrEmpty(formData, "platform");
  const caption = textOrEmpty(formData, "caption");
  if (!organisationId || !pickId) throw new Error("The pick request is incomplete. Refresh and try again.");
  if (!isPublishingPlatform(platformRaw)) throw new Error("Choose a destination platform.");
  if (!caption) throw new Error("Choose a caption.");
  return { organisationId, pickId, platform: platformRaw, caption };
}

function revalidatePicks(organisationId: string) {
  revalidatePath(routes.organisations.picks(organisationId));
  revalidatePath(routes.organisations.publishing.index(organisationId));
  revalidatePath(routes.dashboard);
}

export async function goNowPickAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const input = parseCommon(formData);
    const pick = await loadPick(context, input.organisationId, input.pickId);
    const caption = await resolveApprovedCaption(context, pick, input.caption);
    const draftId = await preparePick(context, pick, input.platform, caption);
    const draft = await context.content.findDraft(input.organisationId, draftId);
    if (!draft) throw new Error("Prepared draft could not be read.");
    const liveEnabled = blotatoConfig().livePublishingEnabled;
    const job = await createImmediatePublishingJob(publishingDeps(context), {
      organisationId: input.organisationId,
      draftId,
      platform: input.platform,
      idempotencyKey: `pick:${pick.id}:immediate:${input.platform}`,
      executionMode: liveEnabled ? "live" : "simulation",
    });
    await context.client.from("picks_queue_items").update({ job_id: job.id, status: "queued" }).eq("id", pick.id);
    revalidatePicks(input.organisationId);
    return successState(liveEnabled ? "GO accepted — queued for provider submission and receipt readback." : "Dry-run GO accepted — queued in simulation mode.", job.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function goAtSlotPickAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const input = parseCommon(formData);
    const scheduledTime = textOrEmpty(formData, "scheduledTime");
    const scheduled = new Date(scheduledTime);
    if (!scheduledTime || Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
      throw new Error("Choose a future UTC slot.");
    }
    const pick = await loadPick(context, input.organisationId, input.pickId);
    const caption = await resolveApprovedCaption(context, pick, input.caption);
    const draftId = await preparePick(context, pick, input.platform, caption);
    const liveEnabled = blotatoConfig().livePublishingEnabled;
    const job = await createScheduledPublishingJob(publishingDeps(context), {
      organisationId: input.organisationId,
      draftId,
      platform: input.platform,
      scheduledFor: scheduled.toISOString(),
      timezone: "UTC",
      idempotencyKey: `pick:${pick.id}:scheduled:${input.platform}:${scheduled.toISOString()}`,
      executionMode: liveEnabled ? "live" : "simulation",
    });
    await context.client.from("picks_queue_items").update({
      job_id: job.id,
      status: "scheduled",
      slot_time: scheduled.toISOString(),
    }).eq("id", pick.id);
    revalidatePicks(input.organisationId);
    return successState(`Scheduled for ${scheduled.toISOString()} — the worker will claim it when due.`, job.id);
  } catch (error) {
    return errorState(error);
  }
}

export async function verifyNativePickAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await requireContext();
    const input = parseCommon(formData);
    const rawUrl = textOrEmpty(formData, "nativeUrl");
    const receipt = await verifyNativePostUrl(input.platform, rawUrl);
    const pick = await loadPick(context, input.organisationId, input.pickId);
    const caption = await resolveApprovedCaption(context, pick, input.caption);
    await preparePick(context, pick, input.platform, caption);
    const { data, error } = await context.client.rpc("record_native_publishing_receipt", {
      p_organisation_id: input.organisationId,
      p_pick_id: input.pickId,
      p_platform: input.platform,
      p_public_url: receipt.publicUrl,
      p_receipt_id: receipt.receiptId,
      p_actor_id: context.actor.id,
    });
    if (error || !data) throw new Error(error?.message ?? "The native receipt could not be recorded.");
    const organisation = await context.organisations.findById(input.organisationId);
    if (organisation) {
      await queueMervicPublishAlert({
        organisationName: organisation.name,
        simulated: false,
        publicUrl: receipt.publicUrl,
        enqueue: async () => {
          const queued = await context.client.rpc("enqueue_mervic_publish_alert", {
            p_organisation_id: input.organisationId,
            p_job_id: data.id,
            p_public_url: receipt.publicUrl,
          });
          if (queued.error) throw new Error(queued.error.message);
        },
      });
    }
    revalidatePicks(input.organisationId);
    return successState("Native post verified live and receipt recorded.", receipt.receiptId);
  } catch (error) {
    return errorState(error);
  }
}
