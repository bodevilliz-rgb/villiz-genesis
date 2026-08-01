import type { AuditEvent } from "@/core/application/ports/audit-port";
import { formatDateTime } from "@/lib/format";

/** Oldest first — a chronological record of every audited event tied to this specific job (queued, retried, cancelled, completed, failed, stale recovery). */
export function JobAuditTrail({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No audit events recorded yet.</p>;
  }

  const ordered = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <ol className="flex flex-col gap-2">
      {ordered.map((event) => (
        <li key={event.id} className="rounded-lg border border-border bg-card p-3 text-[13px]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-foreground">{event.description}</span>
            <span className="text-[11px] text-muted-foreground">{formatDateTime(event.createdAt)}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {event.actor ? (event.actor.fullName ?? event.actor.email) : "System (background worker)"}
          </p>
        </li>
      ))}
    </ol>
  );
}
