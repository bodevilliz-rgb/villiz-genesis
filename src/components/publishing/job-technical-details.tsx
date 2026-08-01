import type { PublishingAttempt, PublishingJob } from "@/core/domain/entities/publishing";

function latestAttempt(attempts: PublishingAttempt[]): PublishingAttempt | null {
  return attempts.reduce<PublishingAttempt | null>(
    (latest, attempt) => (!latest || attempt.attemptNumber > latest.attemptNumber ? attempt : latest),
    null,
  );
}

/** Native `<details>` — no extra dependency needed for a collapsible section, and it's keyboard/screen-reader accessible out of the box. */
export function JobTechnicalDetails({ job, attempts }: { job: PublishingJob; attempts: PublishingAttempt[] }) {
  const latest = latestAttempt(attempts);
  const providerMetadata = latest?.providerMetadata ?? {};
  const hasProviderMetadata = Object.keys(providerMetadata).length > 0;

  return (
    <details className="rounded-lg border border-border bg-card p-3 text-[12px]">
      <summary className="cursor-pointer select-none font-medium text-foreground">Technical details</summary>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="text-[11px] uppercase tracking-wide">Job ID</dt>
          <dd className="break-all text-foreground">{job.id}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide">Draft ID</dt>
          <dd className="break-all text-foreground">{job.draftId}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide">Organisation ID</dt>
          <dd className="break-all text-foreground">{job.organisationId}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide">Idempotency key</dt>
          <dd className="break-all text-foreground">{job.idempotencyKey}</dd>
        </div>
        {job.claimedBy ? (
          <div>
            <dt className="text-[11px] uppercase tracking-wide">Last claimed by</dt>
            <dd className="break-all text-foreground">{job.claimedBy}</dd>
          </div>
        ) : null}
      </dl>
      {hasProviderMetadata ? (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Provider metadata (latest attempt)</p>
          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px] text-foreground">
            {JSON.stringify(providerMetadata, null, 2)}
          </pre>
        </div>
      ) : null}
    </details>
  );
}
