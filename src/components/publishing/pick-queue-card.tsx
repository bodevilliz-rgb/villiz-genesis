"use client";

import { useActionState, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import {
  goAtSlotPickAction,
  goNowPickAction,
  verifyNativePickAction,
} from "@/server/actions/picks-queue";
import { idleState } from "@/server/action-result";
import { FormMessage } from "@/components/common/form-message";
import type { PublishingPlatform } from "@/core/domain/entities/publishing";

export interface PickQueueCardModel {
  id: string;
  itemLabel: string;
  thumbnailUrl: string | null;
  sourceLabel: string;
  captionOptions: [string, string, string];
  platform: PublishingPlatform;
  slotTime: string | null;
  status: string;
  publicUrl: string | null;
  canPublish: boolean;
}

const platformOptions: { value: PublishingPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
];

export function PickQueueCard({ organisationId, pick }: { organisationId: string; pick: PickQueueCardModel }) {
  const [caption, setCaption] = useState(pick.captionOptions[0]);
  const [platform, setPlatform] = useState<PublishingPlatform>(pick.platform);
  const [localSlot, setLocalSlot] = useState("");
  const scheduledTime = useMemo(() => {
    if (!localSlot) return "";
    const parsed = new Date(localSlot);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }, [localSlot]);
  const [goState, goAction] = useActionState(goNowPickAction, idleState);
  const [slotState, slotAction] = useActionState(goAtSlotPickAction, idleState);
  const [nativeState, nativeAction] = useActionState(verifyNativePickAction, idleState);

  const sharedFields = (
    <>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="pickId" value={pick.id} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="caption" value={caption} />
    </>
  );

  return (
    <article className="grid gap-5 rounded-3xl border border-border bg-card p-5 shadow-[0_18px_70px_rgba(0,0,0,0.18)] sm:grid-cols-[128px_1fr]" data-pick-id={pick.id}>
      <div className="aspect-square overflow-hidden rounded-2xl border border-border bg-muted">
        {pick.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed/private and Drive-reference URLs are runtime data.
          <img src={pick.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">Preview unavailable</div>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="line-clamp-1 text-base font-semibold text-foreground">{pick.itemLabel}</h2>
            <p className="text-xs text-muted-foreground">{pick.sourceLabel} · {pick.status}</p>
          </div>
          {pick.publicUrl ? (
            <a href={pick.publicUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium">
              Receipt <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          ) : null}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Choose a MemBrain-grounded caption</legend>
          {pick.captionOptions.map((option, index) => (
            <label key={option} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm leading-5 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name={`caption-${pick.id}`}
                value={option}
                checked={caption === option}
                onChange={() => setCaption(option)}
                className="mt-1"
              />
              <span><strong className="mr-1">{index + 1}.</strong>{option}</span>
            </label>
          ))}
        </fieldset>

        <label className="grid gap-1 text-sm font-medium sm:max-w-xs">
          Destination
          <select value={platform} onChange={(event) => setPlatform(event.target.value as PublishingPlatform)} className="min-h-11 rounded-md border border-border bg-background px-3">
            {platformOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        {!pick.canPublish ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            Drive reference imported. Stage its bytes into the private organisation-media bucket before GO is enabled.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            <form action={goAction} className="space-y-2">
              {sharedFields}
              <button type="submit" className="min-h-12 w-full rounded-xl bg-[linear-gradient(135deg,var(--primary),var(--signal-violet))] px-4 text-sm font-semibold text-white">GO now</button>
              <FormMessage state={goState} />
            </form>

            <form action={slotAction} className="space-y-2">
              {sharedFields}
              <input type="hidden" name="scheduledTime" value={scheduledTime} />
              <label className="grid gap-1 text-xs text-muted-foreground">
                Fire-time slot
                <input type="datetime-local" value={localSlot} onChange={(event) => setLocalSlot(event.target.value)} required className="min-h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
              </label>
              <button type="submit" disabled={!scheduledTime} className="min-h-11 w-full rounded-md border border-primary px-4 text-sm font-semibold text-primary disabled:opacity-50">GO at slot</button>
              {scheduledTime ? <p className="break-all text-xs text-muted-foreground">UTC: {scheduledTime}</p> : null}
              <FormMessage state={slotState} />
            </form>

            <form action={nativeAction} className="space-y-2">
              {sharedFields}
              <label className="grid gap-1 text-xs text-muted-foreground">
                Public platform URL
                <input type="url" name="nativeUrl" required placeholder="https://…" className="min-h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
              </label>
              <button type="submit" className="min-h-11 w-full rounded-md border border-border px-4 text-sm font-semibold text-foreground">I posted natively</button>
              <FormMessage state={nativeState} />
            </form>
          </div>
        )}
      </div>
    </article>
  );
}
