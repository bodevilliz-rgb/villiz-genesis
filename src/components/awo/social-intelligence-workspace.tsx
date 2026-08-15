import Link from "next/link";
import { ArrowUpRight, Brain, CheckCircle2, Send, Sparkles } from "lucide-react";
import type { ClientSocialIntelligence } from "@/core/domain/entities/dashboard";
import type { ExecutiveAttentionItem } from "@/components/dashboard/executive-attention";

export interface AwoPriority extends ExecutiveAttentionItem {
  interpretation: string;
  recommendedAction: string;
}

export interface OperationalIntelligence {
  failedPublications: number;
  queuedPublications: number;
  processingPublications: number;
  publishingSuccessRate: number | null;
  reviewsRequiringApproval: number;
  publishingHref: string;
  reviewHref: string;
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 rounded-md bg-primary px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {label} <ArrowUpRight aria-hidden className="size-3.5" />
    </Link>
  );
}

export function SocialPriorities({ priorities }: { priorities: AwoPriority[] }) {
  return (
    <section aria-labelledby="social-priorities-heading" className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Current signals</p>
        <h2 id="social-priorities-heading" className="mt-1 text-xl font-bold tracking-tight text-white">Social Priorities</h2>
      </div>
      {priorities.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <p className="text-[13px] font-medium text-white">No current social-operation priorities.</p>
          <p className="mt-1 text-[12px] text-subtle-foreground">Genesis has no tracked publishing failures, approval blockers, or readiness issues to explain.</p>
        </div>
      ) : (
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {priorities.map((priority, index) => (
            <li key={`${priority.kind}-${priority.href}`} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/40 font-mono text-[10px] font-bold text-primary">{index + 1}</span>
                <div>
                  <h3 className="text-[14px] font-semibold text-white">{priority.title}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{priority.detail}</p>
                  <Link href={priority.href} className="mt-3 inline-flex items-center gap-1 rounded text-[12px] font-semibold text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    {priority.actionLabel} <ArrowUpRight aria-hidden className="size-3.5" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function PriorityIntelligence({ priority }: { priority: AwoPriority | null }) {
  if (!priority) return null;
  return (
    <section aria-labelledby="priority-intelligence-heading" className="rounded-lg border border-primary/40 bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="size-4 text-primary" />
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Highest current priority</p>
      </div>
      <h2 id="priority-intelligence-heading" className="mt-2 text-xl font-bold tracking-tight text-white">{priority.title}</h2>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div><p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">What is happening</p><p className="mt-1 text-[13px] leading-relaxed text-white">{priority.detail}</p></div>
        <div><p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">Why it matters</p><p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{priority.interpretation}</p></div>
        <div><p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">Recommended action</p><p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{priority.recommendedAction}</p></div>
      </div>
      <div className="mt-5"><ActionLink href={priority.href} label={priority.actionLabel} /></div>
    </section>
  );
}

export function ClientIntelligence({ clients, membrainHref, campaignHref }: {
  clients: ClientSocialIntelligence[];
  membrainHref: (organisationId: string) => string;
  campaignHref: (organisationId: string, campaignId: string) => string;
}) {
  return (
    <section aria-labelledby="client-intelligence-heading" className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Portfolio intelligence</p>
        <h2 id="client-intelligence-heading" className="mt-1 text-xl font-bold tracking-tight text-white">Client Intelligence</h2>
      </div>
      {clients.length === 0 ? <p className="rounded-lg border border-border bg-card p-5 text-[13px] text-muted-foreground">No authorised client intelligence is available.</p> : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {clients.map((client) => (
            <li key={client.organisationId} className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold text-white">{client.organisationName}</h3><p className="mt-1 text-[12px] text-muted-foreground">MemBrain readiness from active client knowledge.</p></div>
                <span className="font-mono text-lg font-bold tabular-nums text-primary">{client.membrainReadinessPercent}%</span>
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">Active campaign readiness</p>
                {client.activeCampaigns.length === 0 ? <p className="mt-2 text-[12px] text-subtle-foreground">No active campaign readiness to assess.</p> : (
                  <ul className="mt-2 space-y-2">
                    {client.activeCampaigns.map((campaign) => (
                      <li key={campaign.campaignId} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                        <span className="text-muted-foreground">{campaign.name}</span>
                        <span className="font-mono text-white">{campaign.readiness ? `${campaign.readiness.score}%` : "Unavailable"}</span>
                        <Link href={campaignHref(client.organisationId, campaign.campaignId)} className="rounded font-semibold text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Open campaign</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-4"><ActionLink href={membrainHref(client.organisationId)} label="Open MemBrain" /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OperationalIntelligencePanel({ intelligence }: { intelligence: OperationalIntelligence }) {
  const rate = intelligence.publishingSuccessRate === null ? "No resolved data" : `${intelligence.publishingSuccessRate}%`;
  return (
    <section aria-labelledby="operational-intelligence-heading" className="flex flex-col gap-4">
      <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Current operation</p><h2 id="operational-intelligence-heading" className="mt-1 text-xl font-bold tracking-tight text-white">Operational Intelligence</h2></div>
      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2"><Send aria-hidden className="size-4 text-primary" /><h3 className="font-semibold text-white">Publishing</h3></div>
          <p className="mt-3 text-[13px] text-muted-foreground"><strong className="text-white">{intelligence.failedPublications}</strong> failed, <strong className="text-white">{intelligence.queuedPublications}</strong> queued and <strong className="text-white">{intelligence.processingPublications}</strong> processing.</p>
          <p className="mt-2 text-[12px] text-subtle-foreground">Overall publishing success: {rate}</p>
          <p className="mt-1 text-[12px] text-subtle-foreground">Based on all resolved publishing jobs.</p>
          <div className="mt-4"><ActionLink href={intelligence.publishingHref} label="Open Publishing" /></div>
        </article>
        <article className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2"><CheckCircle2 aria-hidden className="size-4 text-primary" /><h3 className="font-semibold text-white">Reviews</h3></div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            {intelligence.reviewsRequiringApproval === 0
              ? "No reviews currently require action."
              : <><strong className="text-white">{intelligence.reviewsRequiringApproval}</strong> {intelligence.reviewsRequiringApproval === 1 ? "review is" : "reviews are"} awaiting action in the current workflow.</>}
          </p>
          <div className="mt-4"><ActionLink href={intelligence.reviewHref} label="Open Reviews" /></div>
        </article>
      </div>
    </section>
  );
}

export function EngagementIntelligenceBoundary() {
  return (
    <section aria-labelledby="engagement-intelligence-heading" className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2"><Brain aria-hidden className="size-4 text-primary" /><h2 id="engagement-intelligence-heading" className="font-semibold text-white">Social &amp; Engagement Intelligence</h2></div>
      <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">Engagement intelligence is currently available at content level.</p>
      <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-subtle-foreground">Open an individual content draft to review its recommendations, evidence, learning and performance results.</p>
    </section>
  );
}
