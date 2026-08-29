"use client";

import { CheckCircle2, Clock3, Database, Link2Off } from "lucide-react";
import type { EngagementMetricSnapshot } from "@/core/domain/entities/engagement";
import {
  buildPostPerformanceView,
  engagementPerThousand,
  PERFORMANCE_CHECKPOINTS,
} from "@/core/application/use-cases/engagement/post-performance";

const METRICS = [
  ["reach", "Reach"],
  ["views", "Views"],
  ["impressions", "Impressions"],
  ["likes", "Likes"],
  ["comments", "Comments"],
  ["saves", "Saves"],
  ["shares", "Shares"],
  ["clicks", "Clicks"],
] as const;

function value(snapshot: EngagementMetricSnapshot, key: string): string {
  const metric = snapshot.metrics[key];
  return metric === null || metric === undefined ? "—" : new Intl.NumberFormat("en-GB").format(metric);
}

function capturedAt(snapshot: EngagementMetricSnapshot): string {
  return new Date(snapshot.providerCapturedAt ?? snapshot.observedAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function CheckpointCard({ label, snapshot }: { label: string; snapshot?: EngagementMetricSnapshot }) {
  if (!snapshot) {
    return (
      <div className="rounded-md border border-dashed border-border p-2.5">
        <p className="text-[11px] font-semibold">{label}</p>
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock3 className="size-3" aria-hidden /> Waiting for checkpoint
        </p>
      </div>
    );
  }
  const rate = engagementPerThousand(snapshot.metrics);
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold">{label}</p>
        <CheckCircle2 className="size-3.5 text-positive" aria-label="Collected" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <p className="text-muted-foreground">Reach/views</p>
        <p className="text-right font-medium">{value(snapshot, snapshot.metrics.reach != null ? "reach" : "views")}</p>
        <p className="text-muted-foreground">Interactions</p>
        <p className="text-right font-medium">
          {["likes", "comments", "shares", "saves"].reduce((sum, key) => sum + (snapshot.metrics[key] ?? 0), 0).toLocaleString("en-GB")}
        </p>
        <p className="text-muted-foreground">Per 1,000</p>
        <p className="text-right font-medium">{rate === null ? "—" : rate.toLocaleString("en-GB")}</p>
      </div>
    </div>
  );
}

export function PostPerformanceDashboard({ snapshots }: { snapshots: EngagementMetricSnapshot[] }) {
  const performance = buildPostPerformanceView(snapshots);
  if (!performance.latest) {
    return (
      <section className="rounded-md border border-dashed border-border p-3" aria-label="Post performance">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="text-[12px] font-semibold">Post performance</h3>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          No provider metrics have been collected for the latest published post yet. Use Refresh analytics or wait for the next scheduled collection.
        </p>
      </section>
    );
  }

  const latest = performance.latest;
  const learningMessage = performance.attributionStatus === "unverified"
    ? "Attribution unverified. Metrics remain visible, but this post is excluded from recommendation learning."
    : performance.evidenceStatus === "awaiting_7d"
      ? `Attribution verified. Learning remains pending until the seven-day checkpoint reaches at least ${performance.minimumLearningExposure.toLocaleString("en-GB")} reach/views.`
      : performance.evidenceStatus === "insufficient_exposure"
        ? `Attribution verified, but the seven-day sample is below ${performance.minimumLearningExposure.toLocaleString("en-GB")} reach/views. It is excluded from model learning as low-sample noise.`
        : "Attribution and seven-day exposure verified. This post is eligible for comparable learning; results remain observational, not causal.";
  return (
    <section className="grid gap-3 rounded-md border border-border p-3" aria-label="Post performance">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-semibold">Post performance</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Latest provider capture · {capturedAt(latest)}</p>
        </div>
        <span className="rounded-full bg-positive/10 px-2 py-1 text-[10px] font-medium text-positive">Collected</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {METRICS.map(([key, label]) => (
          <div key={key} className="rounded-md border border-border bg-card px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums">{value(latest, key)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md bg-muted/40 p-2.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Engagement per 1,000 reach/views</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {performance.engagementPerThousand === null ? "Not enough data" : performance.engagementPerThousand.toLocaleString("en-GB")}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">Likes, comments, shares and saves normalised against reach, with views used only as fallback.</p>
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Checkpoint history</p>
        <div className="grid gap-2">
          {PERFORMANCE_CHECKPOINTS.map((checkpoint) => (
            <CheckpointCard key={checkpoint} label={checkpoint === "7d" ? "7 days" : checkpoint} snapshot={performance.checkpoints[checkpoint]} />
          ))}
        </div>
      </div>

      <div className={`flex items-start gap-2 rounded-md p-2.5 text-[11px] ${performance.learningStatus === "eligible" ? "bg-positive/5 text-positive" : "bg-warning-soft text-warning"}`}>
        {performance.learningStatus === "eligible"
          ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          : performance.attributionStatus === "unverified"
            ? <Link2Off className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            : <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
        <div>
          <p className="font-medium">{performance.attributionStatus === "verified" ? "Attribution verified" : "Attribution unverified"} · {performance.learningStatus === "eligible" ? "Learning eligible" : "Learning not eligible"}</p>
          <p className="mt-0.5">{learningMessage}</p>
        </div>
      </div>

      <p className="text-[10px] text-subtle-foreground">Source: Blotato/provider analytics. Results are observational and do not prove that a caption caused performance.</p>
    </section>
  );
}
