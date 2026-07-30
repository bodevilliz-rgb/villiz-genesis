import Link from "next/link";
import { notFound } from "next/navigation";
import { Brain, CheckCircle2, Plus } from "lucide-react";
import { requireContext } from "@/server/container";
import { searchMembrain, listTags, getMembrainOverview } from "@/core/application/use-cases/membrain";
import type { MembrainOverview } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Stat } from "@/components/common/stat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchFilters } from "@/components/membrain/search-filters";
import { SearchResults } from "@/components/membrain/search-results";
import { ContextInspector } from "@/components/membrain/context-inspector";
import { canWriteContent } from "@/core/domain/entities/identity";
import type { MembrainStatus } from "@/core/domain/entities/membrain";
import { formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const VALID_STATUSES: MembrainStatus[] = ["draft", "active", "archived"];

export default async function MembrainPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ q?: string; category?: string; status?: string }>;
}) {
  const { orgId } = await params;
  const filters = await searchParams;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const deps = {
    actor: context.actor,
    membrain: context.membrain,
    organisations: context.organisations,
  };

  const status = filters.status && VALID_STATUSES.includes(filters.status as MembrainStatus)
    ? (filters.status as MembrainStatus)
    : undefined;

  const [overview, tags, viewerRole] = await Promise.all([
    getMembrainOverview(deps, orgId),
    listTags(deps, orgId),
    context.organisations.viewerRole(orgId),
  ]);
  const { categories } = overview;

  const results = await searchMembrain(deps, {
    organisationId: orgId,
    query: filters.q,
    categoryIds: filters.category ? [filters.category] : undefined,
    statuses: status ? [status] : filters.status === "" ? undefined : ["active", "draft"],
    limit: 50,
    offset: 0,
  });

  const canWrite = canWriteContent(context.actor, viewerRole);
  const categoryLabels = new Map(categories.map((c) => [c.id, c.label]));
  const isFiltered = Boolean(filters.q || filters.category || filters.status);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="MemBrain"
        title="What we know about this client"
        description="Institutional memory for the account. Every AI feature in Project Genesis reads from here, so what is written here is what gets produced."
        actions={
          canWrite ? (
            <Button asChild variant="primary">
              <Link href={routes.organisations.membrain.new(orgId)}>
                <Plus aria-hidden />
                Add knowledge
              </Link>
            </Button>
          ) : null
        }
      />

      <MembrainReadinessCard overview={overview} />

      <MembrainCategoryGrid orgId={orgId} overview={overview} />

      <SearchFilters
        categories={categories}
        defaults={{ q: filters.q, category: filters.category, status: filters.status ?? "" }}
      />

      {results.hits.length === 0 ? (
        <EmptyState
          icon={<Brain aria-hidden />}
          title={isFiltered ? "Nothing matches that" : "MemBrain is empty"}
          description={
            isFiltered
              ? "Try fewer words, or clear the filters. Search covers titles, summaries and the knowledge itself."
              : "Readiness is calculated from six fundamentals. Fill them in this order and every AI feature will have what it needs:"
          }
          action={
            canWrite && !isFiltered ? (
              <div className="flex flex-col items-center gap-3">
                <ol className="flex flex-col gap-1 text-left text-[13px] text-muted-foreground">
                  {overview.readiness.signals.map((signal, index) => (
                    <li key={signal.categoryKey}>
                      {index + 1}. {signal.label}
                    </li>
                  ))}
                </ol>
                <Button asChild variant="primary">
                  <Link href={routes.organisations.membrain.new(orgId)}>Add the first entry</Link>
                </Button>
              </div>
            ) : isFiltered ? (
              <Button asChild variant="secondary">
                <Link href={routes.organisations.membrain.index(orgId)}>Clear filters</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">
            {formatNumber(results.total)} {results.total === 1 ? "entry" : "entries"}
            {filters.q ? ` for “${filters.q}”` : ""}
          </p>
          <SearchResults organisationId={orgId} hits={results.hits} categoryLabels={categoryLabels} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>AI context inspector</CardTitle>
          <CardDescription>
            See exactly what a model will be told about this client before anything is generated. Importance 4 and
            above is always included, whatever you search for.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContextInspector organisationId={orgId} />
        </CardContent>
      </Card>

      {tags.length > 0 ? (
        <p className="text-[12px] text-subtle-foreground">
          Tags in use: {tags.map((tag) => tag.name).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Readiness is deliberately shown before the search/filter tools below it —
 * it answers "is this MemBrain good enough yet", which matters more than
 * "can I find a specific entry" the first time someone opens this page.
 */
function MembrainReadinessCard({ overview }: { overview: MembrainOverview }) {
  const { readiness, totalEntries } = overview;
  const isReady = readiness.percentage === 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Readiness</CardTitle>
        <CardDescription>
          Whether the fundamentals every AI feature depends on have been written down yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Knowledge entries" value={formatNumber(totalEntries)} />
          <Stat
            label="Readiness"
            value={`${readiness.percentage}%`}
            detail={`${readiness.metCount} of ${readiness.totalSignals} fundamentals covered`}
          />
        </div>

        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={readiness.percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`MemBrain readiness: ${readiness.percentage}%`}
        >
          <div
            className={cn("h-full rounded-full transition-[width]", isReady ? "bg-positive" : "bg-primary")}
            style={{ width: `${readiness.percentage}%` }}
          />
        </div>

        {isReady ? (
          <p className="flex items-center gap-2 text-[13px] text-positive">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            Every fundamental is covered. AI features have what they need for this client.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] uppercase tracking-wider text-subtle-foreground">Still missing</p>
            <ul className="flex flex-wrap gap-1.5">
              {readiness.missingAreas.map((area) => (
                <li key={area.categoryKey}>
                  <Badge tone="warning">
                    {area.label}
                    {area.requiredCount > 1 ? ` (${area.entryCount}/${area.requiredCount})` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Entries grouped by category, so a strategist can see the shape of what is
 * (and is not) recorded at a glance, rather than only being able to search
 * for something they already suspect exists.
 */
function MembrainCategoryGrid({ orgId, overview }: { orgId: string; overview: MembrainOverview }) {
  const { groups, uncategorised } = overview;
  if (groups.every((group) => group.entries.length === 0) && uncategorised.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge by category</CardTitle>
        <CardDescription>Select a category to see everything recorded under it.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(({ category, entries }) => (
            <li key={category.id}>
              <Link
                href={`${routes.organisations.membrain.index(orgId)}?category=${category.id}`}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-[13px] transition-colors",
                  entries.length > 0
                    ? "border-border bg-card hover:bg-card-hover"
                    : "border-dashed border-border text-subtle-foreground hover:bg-card-hover",
                )}
              >
                <span className="truncate">{category.label}</span>
                <Badge tone={entries.length > 0 ? "accent" : "muted"}>{entries.length}</Badge>
              </Link>
            </li>
          ))}
          {uncategorised.length > 0 ? (
            <li>
              <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2 text-[13px] text-subtle-foreground">
                <span className="truncate">Uncategorised</span>
                <Badge tone="muted">{uncategorised.length}</Badge>
              </div>
            </li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  );
}
