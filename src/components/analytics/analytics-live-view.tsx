"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BarChart3, Check, Clock3, Radio, Sparkles } from "lucide-react";
import { routes } from "@/lib/routes";

export interface AnalyticsAttempt {
  id: string;
  organisationId: string;
  organisationName: string;
  platform: string;
  status: string;
  externalUrl: string | null;
  externalPostId: string | null;
  createdAt: string;
  scheduledFor: string | null;
  captionPattern: string;
}

export interface AnalyticsSnapshot {
  publishingAttemptId: string;
  organisationId: string;
  organisationName: string;
  platform: string;
  observedAt: string;
  metrics: Record<string, number | null>;
}

export interface WeeklyScorecardRow {
  organisationName: string;
  platform: string;
  captionPattern: string;
  slot: string;
  posts: number;
  views: number | null;
  likes: number | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function metricValue(metrics: Record<string, number | null>, names: string[]): number | null {
  for (const name of names) {
    const value = metrics[name];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function safePublicUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function latestByAttempt(snapshots: AnalyticsSnapshot[]): Map<string, AnalyticsSnapshot> {
  const latest = new Map<string, AnalyticsSnapshot>();
  for (const snapshot of snapshots) {
    const current = latest.get(snapshot.publishingAttemptId);
    if (!current || Date.parse(snapshot.observedAt) > Date.parse(current.observedAt)) {
      latest.set(snapshot.publishingAttemptId, snapshot);
    }
  }
  return latest;
}

export function buildWeeklyScorecard(
  attempts: AnalyticsAttempt[],
  snapshots: AnalyticsSnapshot[],
  now: Date = new Date(),
): WeeklyScorecardRow[] {
  const cutoff = now.getTime() - WEEK_MS;
  const latest = latestByAttempt(snapshots);
  const groups = new Map<string, WeeklyScorecardRow>();

  for (const attempt of attempts) {
    if (Date.parse(attempt.createdAt) < cutoff) continue;
    const scheduled = attempt.scheduledFor ? new Date(attempt.scheduledFor) : new Date(attempt.createdAt);
    const hour = Number.isNaN(scheduled.getTime()) ? "Unknown" : `${String(scheduled.getUTCHours()).padStart(2, "0")}:00 UTC`;
    const key = [attempt.organisationName, attempt.platform, attempt.captionPattern, hour].join("\u0000");
    const snapshot = latest.get(attempt.id);
    const views = snapshot ? metricValue(snapshot.metrics, ["views", "reach", "impressions"]) : null;
    const likes = snapshot ? metricValue(snapshot.metrics, ["likes"]) : null;
    const row = groups.get(key) ?? {
      organisationName: attempt.organisationName,
      platform: attempt.platform,
      captionPattern: attempt.captionPattern,
      slot: hour,
      posts: 0,
      views: null,
      likes: null,
    };
    row.posts += 1;
    row.views = views === null ? row.views : (row.views ?? 0) + views;
    row.likes = likes === null ? row.likes : (row.likes ?? 0) + likes;
    groups.set(key, row);
  }

  return [...groups.values()].sort((a, b) =>
    [a.organisationName, a.platform, a.captionPattern, a.slot]
      .join("|")
      .localeCompare([b.organisationName, b.platform, b.captionPattern, b.slot].join("|")),
  );
}

function formatMetric(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ReceiptState({ attempt }: { attempt: AnalyticsAttempt }) {
  const url = safePublicUrl(attempt.externalUrl);
  if (url) {
    return <span className="inline-flex items-center gap-2 text-positive"><Check aria-hidden className="size-4" />Verified</span>;
  }
  if (attempt.status === "queued") {
    return <span className="inline-flex items-center gap-2 text-warning"><Clock3 aria-hidden className="size-4" />Scheduled</span>;
  }
  return <span className="inline-flex items-center gap-2 text-warning"><Radio aria-hidden className="size-4" />Pending readback</span>;
}

export function AnalyticsLiveView({
  attempts,
  snapshots,
  updatedAt,
}: {
  attempts: AnalyticsAttempt[];
  snapshots: AnalyticsSnapshot[];
  updatedAt: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"feed" | "scorecard">("feed");
  const latest = useMemo(() => latestByAttempt(snapshots), [snapshots]);
  const scorecard = useMemo(() => buildWeeklyScorecard(attempts, snapshots, new Date(updatedAt)), [attempts, snapshots, updatedAt]);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 45_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card/90 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="inline-flex rounded-2xl bg-muted p-1" role="tablist" aria-label="Analytics views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "feed"}
            onClick={() => setTab("feed")}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${tab === "feed" ? "bg-[linear-gradient(135deg,var(--primary),var(--signal-violet))] text-white" : "text-muted-foreground"}`}
          >
            Live feed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "scorecard"}
            onClick={() => setTab("scorecard")}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${tab === "scorecard" ? "bg-[linear-gradient(135deg,var(--primary),var(--signal-violet))] text-white" : "text-muted-foreground"}`}
          >
            Scorecard
          </button>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Last updated {formatUpdatedAt(updatedAt)} · refreshes every 45 seconds
        </p>
      </div>

      {tab === "feed" ? (
        <section aria-labelledby="publishing-attempts-heading" className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-primary">Publishing attempts</p>
            <h2 id="publishing-attempts-heading" className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Recent receipts</h2>
          </div>
          {attempts.length === 0 ? (
            <div className="rounded-3xl border border-border bg-card p-6 text-base text-muted-foreground">No publishing attempts are available yet.</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {attempts.slice(0, 12).map((attempt) => {
                const snapshot = latest.get(attempt.id);
                const views = snapshot ? metricValue(snapshot.metrics, ["views", "reach", "impressions"]) : null;
                const likes = snapshot ? metricValue(snapshot.metrics, ["likes"]) : null;
                const follows = snapshot ? metricValue(snapshot.metrics, ["followers", "follows", "followersGained"]) : null;
                const publicUrl = safePublicUrl(attempt.externalUrl);
                return (
                  <article key={attempt.id} className="overflow-hidden rounded-3xl border border-border bg-card shadow-[0_18px_60px_rgba(0,0,0,0.2)]">
                    <div className="flex min-h-32 items-end bg-[radial-gradient(circle_at_15%_10%,rgba(255,122,26,0.3),transparent_48%),radial-gradient(circle_at_90%_10%,rgba(139,92,246,0.28),transparent_50%),var(--muted)] p-5">
                      <div className="flex w-full items-end justify-between gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">{attempt.organisationName}</p>
                          <h3 className="mt-1 text-lg font-semibold capitalize">{attempt.platform}</h3>
                        </div>
                        {publicUrl ? (
                          <a
                            href={publicUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={`Open verified post for ${attempt.organisationName}`}
                            className="grid size-11 place-items-center rounded-xl bg-white/10 text-foreground transition-colors hover:bg-white/20"
                          >
                            <ArrowUpRight aria-hidden className="size-5" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-5 p-5">
                      <div className="text-sm font-medium"><ReceiptState attempt={attempt} /></div>
                      <dl className="grid grid-cols-3 gap-3">
                        {[["Views", views], ["Likes", likes], ["Follows", follows]].map(([label, value]) => (
                          <div key={String(label)}>
                            <dt className="text-sm text-muted-foreground">{label}</dt>
                            <dd className="mt-1 text-xl font-semibold">{formatMetric(value as number | null)}</dd>
                          </div>
                        ))}
                      </dl>
                      {snapshot ? (
                        <p className="text-sm text-muted-foreground">Provider snapshot · {new Date(snapshot.observedAt).toLocaleDateString()}</p>
                      ) : (
                        <p className="text-sm text-[var(--signal-soft)]">Metrics awaiting first sync</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section aria-labelledby="scorecard-heading" className="flex flex-col gap-5">
          <div>
            <p className="text-sm font-semibold text-primary">Last seven days</p>
            <h2 id="scorecard-heading" className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Weekly scorecard</h2>
            <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">Grouped by client, platform, selected caption pattern and UTC publishing slot. Missing provider checkpoints stay blank.</p>
          </div>
          <div className="overflow-x-auto rounded-3xl border border-border bg-card">
            {scorecard.length === 0 ? (
              <p className="p-6 text-base text-muted-foreground">No completed or scheduled posts fall inside this scorecard window.</p>
            ) : (
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>{["Client", "Platform", "Caption pattern", "Slot", "Posts", "Views", "Likes"].map((heading) => <th key={heading} className="px-5 py-4 font-medium">{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {scorecard.map((row) => (
                    <tr key={[row.organisationName, row.platform, row.captionPattern, row.slot].join("-")} className="border-b border-border last:border-0">
                      <td className="px-5 py-4 font-semibold">{row.organisationName}</td>
                      <td className="px-5 py-4 capitalize">{row.platform}</td>
                      <td className="px-5 py-4 capitalize">{row.captionPattern.replaceAll("_", " ")}</td>
                      <td className="px-5 py-4">{row.slot}</td>
                      <td className="px-5 py-4">{row.posts}</td>
                      <td className="px-5 py-4">{formatMetric(row.views)}</td>
                      <td className="px-5 py-4">{formatMetric(row.likes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <aside className="rounded-3xl border border-border bg-[linear-gradient(135deg,rgba(255,122,26,0.12),rgba(139,92,246,0.14))] p-6">
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--primary),var(--signal-violet))] text-white"><Sparkles aria-hidden className="size-5" /></span>
              <div>
                <h3 className="text-lg font-semibold">Proposed tweaks</h3>
                <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">No review proposal is waiting this week. Proposals are review notes only: publishing configuration can change only after the owner records an explicit GO action.</p>
                <Link href={routes.review} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong px-4 text-sm font-semibold hover:bg-muted">
                  <BarChart3 aria-hidden className="size-4" /> Open review lane
                </Link>
              </div>
            </div>
          </aside>
        </section>
      )}
    </div>
  );
}
