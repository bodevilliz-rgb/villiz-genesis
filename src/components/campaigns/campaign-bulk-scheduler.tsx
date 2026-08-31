"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Layers3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { MediaAsset } from "@/core/domain/entities/media";
import {
  CAMPAIGN_PLATFORM_LABELS,
  type CampaignPlatform,
} from "@/core/domain/entities/campaign";
import { buildCampaignScheduleAction } from "@/server/actions/campaign-builder";

interface Props {
  organisationId: string;
  campaignId: string;
  campaignPlatforms: CampaignPlatform[];
  campaignStartDate: string | null;
  attachedAssets: MediaAsset[];
  signedUrls: Record<string, string>;
  canWrite: boolean;
}

export function CampaignBulkScheduler({
  organisationId,
  campaignId,
  campaignPlatforms,
  campaignStartDate,
  attachedAssets,
  signedUrls,
  canWrite,
}: Props) {
  const [weeks, setWeeks] = useState(14);
  const [firstDate, setFirstDate] = useState(campaignStartDate ?? "");
  const [time, setTime] = useState("09:00");
  const [timezone, setTimezone] = useState("Europe/London");
  const [platforms, setPlatforms] = useState<CampaignPlatform[]>(campaignPlatforms);
  const [orderedAssets, setOrderedAssets] = useState(attachedAssets);
  const [isPending, startTransition] = useTransition();

  const ready = orderedAssets.length === weeks && platforms.length > 0 && Boolean(firstDate) && Boolean(time);
  const slotCount = weeks * platforms.length;

  const scheduleDates = useMemo(() => {
    if (!firstDate || !/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return [];
    const [year, month, day] = firstDate.split("-").map(Number);
    const start = new Date(Date.UTC(year!, month! - 1, day));
    return Array.from({ length: weeks }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index * 7);
      return date.toISOString().slice(0, 10);
    });
  }, [firstDate, weeks]);

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= orderedAssets.length) return;
    setOrderedAssets((current) => {
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next]!, copy[index]!];
      return copy;
    });
  }

  function togglePlatform(platform: CampaignPlatform) {
    setPlatforms((current) =>
      current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform],
    );
  }

  function buildSchedule() {
    startTransition(async () => {
      const result = await buildCampaignScheduleAction({
        organisationId,
        campaignId,
        assetIds: orderedAssets.slice(0, weeks).map((asset) => asset.id),
        platforms,
        weeks,
        firstDate,
        time,
        timezone,
      });
      if (result.status === "success") toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" /> Campaign Builder
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="rounded-md border border-border bg-muted/20 p-4">
          <p className="text-[13px] font-medium">Upload once. Plan every platform.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Put the campaign images in week order, choose the first publish date and time, then Genesis creates the complete weekly multi-platform schedule.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-[12px] font-medium">
            Weeks
            <Select value={String(weeks)} onChange={(event) => setWeeks(Number(event.target.value))} disabled={!canWrite}>
              {[4, 6, 8, 10, 12, 14, 16, 20, 26, 52].map((value) => (
                <option key={value} value={value}>{value} weeks</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-medium">
            First publish date
            <Input type="date" value={firstDate} onChange={(event) => setFirstDate(event.target.value)} disabled={!canWrite} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-medium">
            Publish time
            <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={!canWrite} />
          </label>
        </div>

        <label className="flex max-w-sm flex-col gap-1.5 text-[12px] font-medium">
          Timezone
          <Select value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={!canWrite}>
            <option value="Europe/London">UK — Europe/London</option>
            <option value="Africa/Lagos">Nigeria — Africa/Lagos</option>
            <option value="UTC">UTC</option>
          </Select>
        </label>

        <div>
          <p className="mb-2 text-[12px] font-medium">Publish to</p>
          <div className="flex flex-wrap gap-2">
            {campaignPlatforms.map((platform) => (
              <label key={platform} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={platforms.includes(platform)}
                  onChange={() => togglePlatform(platform)}
                  disabled={!canWrite}
                  className="size-4 accent-primary"
                />
                {CAMPAIGN_PLATFORM_LABELS[platform]}
              </label>
            ))}
          </div>
          {campaignPlatforms.length === 0 ? (
            <p className="mt-2 text-[12px] text-negative">Edit the campaign and select at least one platform first.</p>
          ) : null}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium">Weekly image order</p>
              <p className="text-[11px] text-muted-foreground">Need {weeks} images · currently {orderedAssets.length}</p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
              {slotCount} platform slots
            </span>
          </div>

          {orderedAssets.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-5 text-center text-[12px] text-muted-foreground">
              Link your campaign images in “Campaign Media & Creative Assets” first.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {orderedAssets.map((asset, index) => (
                <div key={asset.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border p-2.5">
                  {asset.mimeType.startsWith("image/") && signedUrls[asset.storagePath] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signedUrls[asset.storagePath]} alt="" className="size-12 rounded object-cover" />
                  ) : (
                    <div className="flex size-12 items-center justify-center rounded bg-muted"><Layers3 className="size-4" /></div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium">Week {index + 1}: {asset.title || asset.fileName}</p>
                    <p className="text-[11px] text-muted-foreground">{scheduleDates[index] ?? "Date pending"} · {time || "Time pending"}</p>
                  </div>
                  {canWrite ? (
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => move(index, -1)} disabled={index === 0 || isPending} aria-label={`Move week ${index + 1} up`}>
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => move(index, 1)} disabled={index === orderedAssets.length - 1 || isPending} aria-label={`Move week ${index + 1} down`}>
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {orderedAssets.length > weeks ? (
          <p className="text-[12px] text-negative">This schedule needs exactly {weeks} linked images. Detach the extras before building it.</p>
        ) : orderedAssets.length < weeks ? (
          <p className="text-[12px] text-negative">Add {weeks - orderedAssets.length} more image{weeks - orderedAssets.length === 1 ? "" : "s"} to complete the campaign.</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="button" onClick={buildSchedule} disabled={!canWrite || !ready || isPending}>
            {isPending ? "Building schedule…" : `Build ${weeks}-week schedule`}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Creates {slotCount} planned publishing slots. Caption optimisation and approval remain required before live publishing.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
