import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/server/container";
import { buildIntentOpportunities, INTENT_CONSENT_STATUSES, INTENT_SOURCES, INTENT_STAGES } from "@/core/domain/entities/intent";
import { createIntentSignalAction } from "@/server/actions/intents";

const input = "w-full rounded-md border border-border bg-input px-3 py-2 text-sm";
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

export default async function IntentPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await requireContext();
  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const signals = await context.intents.listRecent(orgId, since);
  const opportunities = buildIntentOpportunities(signals);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  return <div className="flex max-w-5xl flex-col gap-6">
    <PageHeader eyebrow="Awo" title="Intent Opportunities" description="Turn structured, permission-aware demand signals into timely content opportunities for this client. Never record raw conversations, contact details or sensitive traits." />

    <Card>
      <CardHeader><CardTitle>Record customer intent</CardTitle><CardDescription>Capture the commercial signal in under 30 seconds. Every record is isolated to {organisation.name}.</CardDescription></CardHeader>
      <CardContent>
        <form action={createIntentSignalAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="organisationId" value={orgId} />
          <label className="text-sm">Service requested<input className={input} name="serviceLabel" required minLength={2} maxLength={120} placeholder="Knotless braids" /></label>
          <label className="text-sm">Locality<input className={input} name="locality" maxLength={120} placeholder="Coventry" /></label>
          <label className="text-sm">Desired timeframe<input className={input} name="desiredTimeframe" maxLength={120} placeholder="Within 14 days" /></label>
          <label className="text-sm">Source<select className={input} name="source">{INTENT_SOURCES.map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label>
          <label className="text-sm">Stage<select className={input} name="stage">{INTENT_STAGES.map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label>
          <label className="text-sm">Consent / lawful-use status<select className={input} name="consentStatus">{INTENT_CONSENT_STATUSES.map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label>
          <label className="text-sm">Occurred at<input className={input} name="occurredAt" type="datetime-local" defaultValue={now.slice(0, 16)} required /></label>
          <div className="flex items-end"><button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Record intent</button></div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Demand opportunities</CardTitle><CardDescription>Transparent scoring across the last 30 days. A score recommends an operator response; it never guarantees placement on an individual timeline.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {opportunities.length ? opportunities.map((opportunity) => <article className="rounded-md border border-border p-4" key={opportunity.key}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-medium">{opportunity.serviceLabel}</h2><p className="text-xs text-muted-foreground">{opportunity.locality ?? "Locality not recorded"} · {opportunity.signalCount} signal{opportunity.signalCount === 1 ? "" : "s"}</p></div>
            <div className="text-right"><strong className="font-mono text-lg">{opportunity.intentOpportunityScore}/100</strong><p className="text-xs uppercase tracking-wider text-muted-foreground">{opportunity.priority}</p></div>
          </div>
          <ul className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">{opportunity.rationale.map((reason) => <li key={reason}>• {reason}</li>)}</ul>
          <p className="mt-3 text-xs"><strong>Next decision:</strong> {opportunity.priority === "priority" ? "Create an Awo opportunity brief and prepare approved content now." : opportunity.priority === "recommend" ? "Review suitable media and prepare a timely organic response." : "Continue gathering evidence before activation."}</p>
        </article>) : <p className="text-sm text-muted-foreground">No intent signals recorded in the last 30 days.</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Privacy boundary</CardTitle></CardHeader>
      <CardContent className="text-sm text-muted-foreground">Genesis aggregates service demand. It does not listen to calls, store customer contact details here, infer private thoughts, or target a named individual because of one conversation.</CardContent>
    </Card>
  </div>;
}
