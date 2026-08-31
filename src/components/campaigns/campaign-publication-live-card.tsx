"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Slot = { platformLabel:string; status:string; draftStatus:string|null };

export function CampaignPublicationLiveCard({ weekNumber, scheduledDate, scheduledTime, timezone, slots, optimisedCount, approvedCount, onOptimise }: { weekNumber:number; scheduledDate:string; scheduledTime:string; timezone:string; slots:Slot[]; optimisedCount:number; approvedCount:number; onOptimise:React.ReactNode }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 1000); const refresh = window.setInterval(() => router.refresh(), 15000); return () => { clearInterval(tick); clearInterval(refresh); }; }, [router]);
  const target = useMemo(() => zonedWallTimeToUtc(scheduledDate, scheduledTime, timezone), [scheduledDate, scheduledTime, timezone]);
  const delta = target - now;
  const allPublished = slots.length > 0 && slots.every(s => s.status === "published" || s.draftStatus === "published");
  const anyFailed = slots.some(s => s.status === "failed" || s.draftStatus === "failed");
  const anyPublishing = slots.some(s => s.draftStatus === "publishing" || s.status === "publishing" || s.status === "processing");
  const fullyOptimised = optimisedCount >= slots.length;
  const fullyApproved = approvedCount >= slots.length;
  let label = "Scheduled"; let detail = delta > 0 ? `Due in ${formatDuration(delta)}` : "Due now"; let tone: "positive"|"muted"|"accent"|"neutral" = "muted";
  if (allPublished) { label = "Published"; detail = "Provider publication confirmed"; tone = "positive"; }
  else if (anyFailed) { label = "Failed"; detail = "One or more platform posts failed"; tone = "accent"; }
  else if (anyPublishing) { label = "Publishing"; detail = "Provider submission is in progress"; tone = "accent"; }
  else if (delta <= 0 && !fullyOptimised) { label = "Blocked"; detail = `${formatDuration(Math.abs(delta))} overdue · optimisation incomplete`; tone = "accent"; }
  else if (delta <= 0 && !fullyApproved) { label = "Blocked"; detail = `${formatDuration(Math.abs(delta))} overdue · approval incomplete`; tone = "accent"; }
  else if (delta <= 0) { label = "Due now"; detail = `${formatDuration(Math.abs(delta))} past scheduled time`; tone = "accent"; }

  return <div className="bg-muted/20 p-6">
    <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-medium uppercase tracking-[0.16em] text-subtle-foreground">Publication status</p><Badge tone={tone}>{label}</Badge></div>
    <p className="mt-3 text-xl font-semibold">Week {weekNumber} · {slots.map(s => s.platformLabel).join(" + ")}</p>
    <p className="mt-1 text-sm text-muted-foreground">{scheduledDate} · {scheduledTime.slice(0,5)} · {timezone}</p>
    <p className="mt-3 text-xs font-medium">{detail}</p>
    <div className="mt-4 grid grid-cols-2 gap-2">{slots.map(slot => <div key={slot.platformLabel} className="rounded-md border border-border bg-background/60 p-3"><p className="text-xs font-semibold">{slot.platformLabel}</p><p className="mt-1 text-[11px] text-muted-foreground">{slot.draftStatus ?? slot.status}</p></div>)}</div>
    <div className="mt-5">{onOptimise}</div>
    <Button size="sm" variant="secondary" className="mt-3" disabled={!fullyOptimised}>Approve all</Button>
    <p className="mt-3 text-[11px] text-muted-foreground">This panel updates every second and refreshes server publication state every 15 seconds.</p>
  </div>;
}

function formatDuration(ms:number){ const total=Math.floor(ms/60000); const h=Math.floor(total/60); const m=total%60; return h>0?`${h}h ${m}m`:`${Math.max(m,0)}m`; }

function zonedWallTimeToUtc(date:string,time:string,timeZone:string){
  const [y=1970, mo=1, d=1] = date.split("-").map(Number);
  const [h=0, mi=0, s=0] = time.split(":").map(Number);
  let guess=Date.UTC(y,mo-1,d,h,mi,s);
  for(let i=0;i<3;i++){ const parts=new Intl.DateTimeFormat("en-GB",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess)); const get=(t:string)=>Number(parts.find(p=>p.type===t)?.value ?? 0); const rendered=Date.UTC(get("year"),get("month")-1,get("day"),get("hour"),get("minute"),get("second")); const wanted=Date.UTC(y,mo-1,d,h,mi,s); guess += wanted-rendered; }
  return guess;
}
