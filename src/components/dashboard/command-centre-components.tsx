import React from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { CommandCentreGreeting } from "@/components/dashboard/command-centre-greeting";

// 1. CommandCentreHeader
export function CommandCentreHeader({
  fullName,
  initialGreetingHour,
  totalReviews,
  atRisk,
}: {
  fullName: string | null;
  initialGreetingHour: number;
  totalReviews: number;
  atRisk: number | null;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border pb-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary font-semibold">Operational Command Centre</span>
      <h1 className="font-sans font-extrabold text-3xl tracking-tight text-white">
        <CommandCentreGreeting fullName={fullName} initialHour={initialGreetingHour} />
      </h1>
      <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
        <span className="text-white font-medium">{totalReviews} reviews</span> require approval.{" "}
        {atRisk === null ? (
          <span className="text-subtle-foreground">Campaign risk is not currently tracked.</span>
        ) : (
          <span className="text-primary font-medium">{atRisk} {atRisk === 1 ? "campaign is" : "campaigns are"} at risk.</span>
        )}
      </p>
    </div>
  );
}

// 2. RevenueSummary
export function RevenueSummary() {
  return (
    <div className="flex flex-col items-start text-left sm:items-end sm:text-right">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-subtle-foreground">REVENUE METRIC YTD</span>
      <span className="font-mono text-xl font-bold text-white mt-0.5">—</span>
      <span className="text-[11px] text-subtle-foreground">Not configured in Genesis</span>
    </div>
  );
}

// 3. AwoRecommendationCard
export interface AwoInsight {
  id: string;
  title: string;
  detail: string;
  score?: number;
  type?: string;
  href: string;
  actionLabel: string;
}

export function AwoRecommendationCard({ insight }: { insight?: AwoInsight }) {
  if (!insight) {
    return (
      <div className="border border-border bg-card rounded-lg p-5 flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">Awo Advisory</span>
        <p className="text-[13px] text-muted-foreground">No operational recommendations available.</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="awo-recommendation-title" className="border-l-4 border-primary bg-card border border-y-border border-r-border rounded-r-lg p-6 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-4 text-primary animate-pulse" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary font-bold">Awo Chief of Staff Recommendation</span>
        </div>
        <span className="bg-primary/10 text-primary font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold">
          {insight.type === "attention" ? "Attention" : "Information"}
        </span>
      </div>
      <div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">What needs attention</span>
        <h3 id="awo-recommendation-title" className="mt-1 font-sans font-bold text-lg text-white tracking-tight">{insight.title}</h3>
      </div>
      <div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">Why it matters</span>
        <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">{insight.detail}</p>
      </div>
      <Link
        href={insight.href}
        className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-primary px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {insight.actionLabel} <ArrowUpRight aria-hidden className="size-3.5" />
      </Link>
    </section>
  );
}

// 4. AgencyHealthIndex
export function AgencyHealthIndex({ avgReviewTime, pendingReviews, revisionRate }: { avgReviewTime: string; pendingReviews: number; revisionRate: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <h3 className="font-sans font-bold text-[13px] text-white uppercase tracking-wider border-b border-border pb-2.5">Agency Health Index</h3>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="border-r border-border py-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground block">Avg Review</span>
          <span className="font-mono text-lg font-bold text-white mt-1 block">{avgReviewTime}</span>
        </div>
        <div className="border-r border-border py-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground block">Pending</span>
          <span className="font-mono text-lg font-bold text-primary mt-1 block">{pendingReviews}</span>
        </div>
        <div className="py-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground block">Revision</span>
          <span className="font-mono text-lg font-bold text-white mt-1 block">{revisionRate}</span>
        </div>
      </div>
    </div>
  );
}

// 5. ClientDeliveryStatus
export interface ClientProject {
  id: string;
  name: string;
  clientName: string;
  progress: number | null;
  status: string;
}

export function ClientDeliveryStatus({ projects }: { projects: ClientProject[] }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <h3 className="font-sans font-bold text-[13px] text-white uppercase tracking-wider border-b border-border pb-2.5">Client Delivery Status</h3>
      <div className="flex flex-col gap-3">
        {projects.length === 0 ? (
          <p className="text-[12px] text-subtle-foreground">No active campaigns with delivery metrics.</p>
        ) : (
          projects.map((p) => (
            <div key={p.id} className="flex flex-col gap-1.5 border-b border-border/40 pb-2.5 last:border-0 last:pb-0">
              <div className="flex justify-between items-center text-[13px]">
                <span className="text-white font-medium">{p.clientName} <span className="text-subtle-foreground font-normal">· {p.name}</span></span>
                <span className="text-primary font-mono font-semibold">{p.progress === null ? "—" : `${p.progress}%`}</span>
              </div>
              {p.progress !== null ? (
                <div className="w-full bg-[#1b1b1b] h-1.5 rounded-full overflow-hidden">
                  <div className="bg-primary h-full rounded-full transition-all duration-500" style={{ width: `${p.progress}%` }} />
                </div>
              ) : <span className="text-[10px] text-subtle-foreground">Campaign dates unavailable</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 6. PublishingQueue
export interface PublishingItem {
  id: string;
  title: string;
  timeLabel: string;
  platforms: string[];
}

export function PublishingQueue({ items }: { items: PublishingItem[] }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <h3 className="font-sans font-bold text-[13px] text-white uppercase tracking-wider border-b border-border pb-2.5">Publishing Queue</h3>
      <div className="flex flex-col gap-4">
        {items.length === 0 ? (
          <p className="text-[12px] text-subtle-foreground">No publications scheduled.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="border-l-2 border-primary pl-3 py-0.5 flex flex-col gap-1">
              <span className="font-mono text-[10px] text-primary font-bold uppercase tracking-wider">{item.timeLabel}</span>
              <span className="text-[13px] text-white font-medium">{item.title}</span>
              <span className="text-[11px] text-subtle-foreground">{item.platforms.join(", ")}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 7. LiveActivityFeed
export interface ActivityItem {
  id: string;
  userName: string;
  actionText: string;
  timeLabel: string;
}

export function LiveActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <h3 className="font-sans font-bold text-[13px] text-white uppercase tracking-wider border-b border-border pb-2.5">Live Activity Feed</h3>
      <div className="flex flex-col gap-3 max-h-[240px] overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-[12px] text-subtle-foreground">No recent persisted activity.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="text-[12px] border-b border-border/40 pb-2.5 last:border-0 last:pb-0">
              <span className="text-primary font-semibold">{item.userName} </span>
              <span className="text-muted-foreground">{item.actionText}</span>
              <span className="text-subtle-foreground block font-mono text-[10px] mt-1">{item.timeLabel}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 8. TeamWorkload
export interface StaffWorkload {
  id: string;
  name: string;
  role: string;
  activeCount: number;
}

export function TeamWorkload({ staff }: { staff: StaffWorkload[] }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
      <h3 className="font-sans font-bold text-[13px] text-white uppercase tracking-wider border-b border-border pb-2.5">Team Workload Status</h3>
      <div className="flex flex-col gap-3.5">
        {staff.length === 0 ? (
          <p className="text-[12px] text-subtle-foreground">Work assignment data is not configured in Genesis.</p>
        ) : staff.map((s) => (
          <div key={s.id} className="flex justify-between items-center text-[13px] border-b border-border/40 pb-2.5 last:border-0 last:pb-0">
            <div>
              <strong className="text-white block font-medium">{s.name}</strong>
              <span className="text-subtle-foreground text-[11px] block">{s.role}</span>
            </div>
            <span className={`font-mono font-bold ${s.activeCount > 0 ? "text-primary" : "text-[#10B981]"}`}>
              {s.activeCount} Active
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
