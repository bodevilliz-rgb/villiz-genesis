import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Pencil } from "lucide-react";
import { requireContext } from "@/server/container";
import { getEntry } from "@/core/application/use-cases/membrain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MembrainStatusBadge } from "@/components/common/status-badge";
import { ArchiveEntryButton } from "@/components/membrain/entry-actions";
import { canEditOrganisation, canWriteContent } from "@/core/domain/entities/identity";
import {
  ALWAYS_IN_CONTEXT_THRESHOLD,
  importanceLabel,
  MEMBRAIN_SOURCE_LABELS,
} from "@/core/domain/entities/membrain";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

export default async function EntryPage({
  params,
}: {
  params: Promise<{ orgId: string; entryId: string }>;
}) {
  const { orgId, entryId } = await params;
  const context = await requireContext();

  const deps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const [entry, viewerRole] = await Promise.all([
    getEntry(deps, orgId, entryId).catch(() => null),
    context.organisations.viewerRole(orgId),
  ]);

  if (!entry) notFound();
  const canWrite = canWriteContent(context.actor, viewerRole);
  // Archiving withdraws knowledge from AI context — a lead-only action,
  // distinct from creating/editing which any contributor can do.
  const canArchive = canEditOrganisation(context.actor, viewerRole);
  const inContext = entry.status === "active";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <article className="flex flex-col gap-5">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <MembrainStatusBadge status={entry.status} />
            {entry.category ? <Badge tone="muted">{entry.category.label}</Badge> : null}
            <Badge tone={entry.importance >= ALWAYS_IN_CONTEXT_THRESHOLD ? "accent" : "neutral"}>
              {importanceLabel(entry.importance)}
            </Badge>
            <span className="font-mono text-[11px] text-subtle-foreground">v{entry.version}</span>
          </div>

          <h1 className="text-xl font-semibold tracking-tight">{entry.title}</h1>
          {entry.summary ? <p className="text-[13px] text-muted-foreground">{entry.summary}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              <Button asChild variant="primary" size="sm">
                <Link href={routes.organisations.membrain.edit(orgId, entry.id)}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <Link href={routes.organisations.membrain.history(orgId, entry.id)}>
                <History aria-hidden />
                History
              </Link>
            </Button>
            {canArchive && entry.status !== "archived" ? (
              <ArchiveEntryButton organisationId={orgId} entryId={entry.id} title={entry.title} />
            ) : null}
          </div>
        </header>

        <Card>
          <CardContent className="knowledge-body py-5 text-[14px]">{entry.body}</CardContent>
        </Card>

        {entry.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {entry.tags.map((tag) => (
              <Badge key={tag.id} tone="muted">
                {tag.name}
              </Badge>
            ))}
          </div>
        ) : null}
      </article>

      <aside className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>AI status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-[13px]">
            <p className={inContext ? "text-positive" : "text-muted-foreground"}>
              {inContext
                ? entry.importance >= ALWAYS_IN_CONTEXT_THRESHOLD
                  ? "Always sent to AI features, whatever the brief."
                  : "Sent to AI features when it matches the brief."
                : "Not sent to AI features while it is in this status."}
            </p>
            <Detail label="Times retrieved" value={formatNumber(entry.retrievalCount)} />
            <Detail label="Last retrieved" value={formatRelative(entry.lastRetrievedAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Provenance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-[13px]">
            <Detail label="Source" value={MEMBRAIN_SOURCE_LABELS[entry.source]} />
            {entry.sourceUrl ? (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">Link</p>
                <Link
                  href={entry.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all text-[13px] text-primary underline-offset-4 hover:underline"
                >
                  {entry.sourceUrl}
                </Link>
              </div>
            ) : null}
            <Detail
              label="Added by"
              value={`${entry.createdBy?.fullName ?? entry.createdBy?.email ?? "Unknown"} · ${formatDateTime(entry.createdAt)}`}
            />
            <Detail
              label="Last edited by"
              value={`${entry.updatedBy?.fullName ?? entry.updatedBy?.email ?? "Unknown"} · ${formatDateTime(entry.updatedAt)}`}
            />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}
