import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BarChart3, CheckCircle2, Target, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { requireContext } from "@/server/container";
import { routes } from "@/lib/routes";
import { classifyGrowthEvidence, GROWTH_EVIDENCE_LABELS } from "@/core/domain/services/growth-evidence";

export const metadata: Metadata = { title: "Growth" };

type Experiment = {
  id: string;
  draft_id: string;
  recommendation_id: string;
  variant: string | null;
  created_at: string;
};
type Draft = { id: string; title: string; status: string };
type Recommendation = {
  id: string;
  platform: string;
  objective_type: string;
  confidence: number;
  performance_confidence: number | null;
  creative_guidance: Record<string, unknown>;
};
type Metric = {
  draft_id: string;
  measurement_window: string | null;
  views: number | null;
  reach: number | null;
  impressions: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  profile_visits: number | null;
  observed_at: string;
};
type Outcome = {
  draft_id: string;
  enquiries: number;
  bookings: number;
  revenue_minor: number;
  currency: string;
};

const number = new Intl.NumberFormat("en-GB");

function sum(values: Array<number | null | undefined>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function GrowthPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await requireContext();
  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  // These tables already power AWO's recommendation and publish-to-learn loop.
  // The Growth screen deliberately presents one calm view over them rather
  // than asking operators to manage experiment infrastructure themselves.
  const client = context.client as any;
  const [experimentsResult, draftsResult, recommendationsResult, metricsResult, outcomesResult] = await Promise.all([
    client
      .from("engagement_feedback_events")
      .select("id,draft_id,recommendation_id,variant,created_at")
      .eq("organisation_id", orgId)
      .eq("action", "selected")
      .order("created_at", { ascending: false })
      .limit(50),
    client
      .from("content_drafts")
      .select("id,title,status")
      .eq("organisation_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(200),
    client
      .from("engagement_recommendations")
      .select("id,platform,objective_type,confidence,performance_confidence,creative_guidance")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("engagement_metric_snapshots")
      .select("draft_id,measurement_window,views,reach,impressions,shares,saves,clicks,profile_visits,observed_at")
      .eq("organisation_id", orgId)
      .order("observed_at", { ascending: false })
      .limit(500),
    client
      .from("engagement_commercial_outcomes")
      .select("draft_id,enquiries,bookings,revenue_minor,currency")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const experiments = (experimentsResult.data ?? []) as Experiment[];
  const drafts = new Map(((draftsResult.data ?? []) as Draft[]).map((item) => [item.id, item]));
  const recommendations = new Map(
    ((recommendationsResult.data ?? []) as Recommendation[]).map((item) => [item.id, item]),
  );
  const metrics = (metricsResult.data ?? []) as Metric[];
  const outcomes = (outcomesResult.data ?? []) as Outcome[];

  const totalReach = sum(metrics.map((item) => item.reach ?? item.views ?? item.impressions));
  const totalEnquiries = sum(outcomes.map((item) => item.enquiries));
  const totalBookings = sum(outcomes.map((item) => item.bookings));
  const measuredDrafts = new Set(metrics.map((item) => item.draft_id));
  const activeExperiments = experiments.filter((item) => !measuredDrafts.has(item.draft_id)).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Awo Algorithmic Growth"
        title="Growth"
        description="One clear view of who each post is for, how it is being distributed, and whether it creates enquiries or bookings."
      />

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Target className="size-4 text-primary" />
            <span className="text-[12px] font-medium uppercase tracking-wide">Running tests</span>
          </div>
          <p className="mt-3 text-3xl font-semibold">{activeExperiments}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Approved posts awaiting measurable evidence.</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BarChart3 className="size-4 text-primary" />
            <span className="text-[12px] font-medium uppercase tracking-wide">People reached</span>
          </div>
          <p className="mt-3 text-3xl font-semibold">{number.format(totalReach)}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Provider-confirmed reach or closest available measure.</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="size-4 text-primary" />
            <span className="text-[12px] font-medium uppercase tracking-wide">Business results</span>
          </div>
          <p className="mt-3 text-3xl font-semibold">{totalBookings}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{totalEnquiries} enquiries · {totalBookings} bookings</p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Growth evidence</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Genesis creates this record automatically when an AWO recommendation is applied.
            </p>
          </div>
          <Link
            href={routes.organisations.content.index(orgId)}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-primary hover:underline"
          >
            Create intelligent content <ArrowRight className="size-4" />
          </Link>
        </div>

        {experiments.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-medium">No growth evidence test yet</p>
            <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted-foreground">
              Apply an AWO recommendation to an approved draft. Genesis will register the audience,
              distribution decision and measurement checkpoints automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {experiments.slice(0, 20).map((experiment) => {
              const draft = drafts.get(experiment.draft_id);
              const recommendation = recommendations.get(experiment.recommendation_id);
              const draftMetrics = metrics.filter((item) => item.draft_id === experiment.draft_id);
              const draftOutcomes = outcomes.filter((item) => item.draft_id === experiment.draft_id);
              const reach = sum(draftMetrics.map((item) => item.reach ?? item.views ?? item.impressions));
              const enquiries = sum(draftOutcomes.map((item) => item.enquiries));
              const bookings = sum(draftOutcomes.map((item) => item.bookings));
              const checkpoints = new Set(draftMetrics.map((item) => item.measurement_window).filter(Boolean));
              const evidence = classifyGrowthEvidence({
                comparableObservations: draftMetrics.length,
                completedCheckpoints: checkpoints.size,
                hasCommercialOutcome: enquiries > 0 || bookings > 0,
              });
              const status = draftMetrics.length > 0
                ? "Learning"
                : draft?.status === "published"
                  ? "Measuring"
                  : "Ready to publish";

              return (
                <article key={experiment.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(110px,0.5fr))] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {status}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {recommendation ? titleCase(recommendation.platform) : "Platform pending"}
                      </span>
                    </div>
                    <Link
                      href={routes.organisations.content.draft(orgId, experiment.draft_id)}
                      className="mt-2 block truncate font-medium hover:text-primary"
                    >
                      {draft?.title ?? "Untitled post"}
                    </Link>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      Goal: {recommendation ? titleCase(recommendation.objective_type) : "Not set"}
                      {" · "}AWO confidence {recommendation?.confidence ?? 0}/100
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Reach</p>
                    <p className="mt-1 text-lg font-semibold">{number.format(reach)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Response</p>
                    <p className="mt-1 text-lg font-semibold">{enquiries} enquiries</p>
                    <p className="text-[11px] text-muted-foreground">{bookings} bookings</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Checkpoints</p>
                    <p className="mt-1 text-[13px] font-medium">
                      {checkpoints.size ? [...checkpoints].map((item) => titleCase(String(item))).join(" · ") : "24h · 72h · 7d"}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          ["1", "Choose the audience", "MemBrain and Market Intelligence identify the legitimate audience, locality and service."],
          ["2", "Approve the route", "AWO recommends organic, supporting, retargeting or direct distribution. You remain in control."],
          ["3", "Learn from results", "Genesis compares reach, response and bookings at fixed checkpoints, then improves the next post."],
        ].map(([step, title, copy]) => (
          <div key={step} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">{step}</span>
              <h3 className="font-medium">{title}</h3>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-muted-foreground">{copy}</p>
          </div>
        ))}
      </section>

      <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />
        <p className="text-[13px] leading-6 text-muted-foreground">
          The operator sees one Growth screen. Evidence IDs, attribution and immutable provider snapshots remain protected underneath.
        </p>
      </div>
    </div>
  );
}
