import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { requireContext } from "@/server/container";
import { getContentOverview, listDrafts } from "@/core/application/use-cases/content";
import { getMembrainOverview } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Stat } from "@/components/common/stat";
import { Button } from "@/components/ui/button";
import { DraftSearchFilters } from "@/components/content/draft-search-filters";
import { DraftCard } from "@/components/content/draft-card";
import { KnowledgeCoverage } from "@/components/content/knowledge-coverage";
import { canWriteContent } from "@/core/domain/entities/identity";
import { CONTENT_DRAFT_STATUS_LABELS, type ContentDraftStatus } from "@/core/domain/entities/content";
import { contentDraftStatusSchema, contentDraftTypeSchema } from "@/core/application/dto/content-dto";
import { formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";

const STATUS_ORDER: ContentDraftStatus[] = ["draft", "needs_review", "approved", "rejected"];

export default async function ContentStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ q?: string; status?: string; type?: string; author?: string }>;
}) {
  const { orgId } = await params;
  const filters = await searchParams;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const contentDeps = {
    actor: context.actor,
    content: context.content,
    membrain: context.membrain,
    organisations: context.organisations,
  };
  const membrainDeps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };

  const status = contentDraftStatusSchema.safeParse(filters.status).success
    ? (filters.status as ContentDraftStatus)
    : undefined;
  const contentType = contentDraftTypeSchema.safeParse(filters.type).success ? filters.type : undefined;

  const [overview, drafts, members, viewerRole, membrainOverview] = await Promise.all([
    getContentOverview(contentDeps, orgId),
    listDrafts(contentDeps, {
      organisationId: orgId,
      query: filters.q,
      status,
      contentType,
      authorId: filters.author,
      limit: 50,
      offset: 0,
    }),
    context.organisations.listMembers(orgId),
    context.organisations.viewerRole(orgId),
    getMembrainOverview(membrainDeps, orgId),
  ]);

  const canWrite = canWriteContent(context.actor, viewerRole);
  const isFiltered = Boolean(filters.q || filters.status || filters.type || filters.author);
  const hasAnyDrafts = overview.totalDrafts > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Content Studio"
        title="Drafts for this client"
        description="Prepare content here. Content Studio ends at an approved draft — publishing, scheduling and social platforms are handled downstream, not in this workspace."
        actions={
          canWrite ? (
            <Button asChild variant="primary">
              <Link href={routes.organisations.content.new(orgId)}>
                <Plus aria-hidden />
                New draft
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total drafts" value={formatNumber(overview.totalDrafts)} />
        {STATUS_ORDER.map((s) => (
          <Stat key={s} label={CONTENT_DRAFT_STATUS_LABELS[s]} value={formatNumber(overview.byStatus[s])} />
        ))}
      </div>

      <KnowledgeCoverage
        organisationId={orgId}
        totalEntries={membrainOverview.totalEntries}
        readiness={membrainOverview.readiness}
      />

      {!hasAnyDrafts ? (
        <EmptyState
          icon={<FileText aria-hidden />}
          title="No drafts yet"
          description="Content Studio pulls in what MemBrain already knows about this client, so the fastest path to a good first draft looks like this:"
          action={
            <div className="flex flex-col items-center gap-3">
              <ol className="flex flex-col gap-1.5 text-left text-[13px] text-muted-foreground">
                <li>1. Check MemBrain&apos;s readiness above — fill in anything still missing.</li>
                <li>2. Create a draft and give it a title and a content pillar.</li>
                <li>3. Send a brief to Awo, or just start writing.</li>
              </ol>
              {canWrite ? (
                <Button asChild variant="primary">
                  <Link href={routes.organisations.content.new(orgId)}>Create the first draft</Link>
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <>
          <DraftSearchFilters
            members={members}
            defaults={{ q: filters.q, status: filters.status, type: filters.type, author: filters.author }}
          />

          {drafts.length === 0 ? (
            <EmptyState
              icon={<FileText aria-hidden />}
              title="Nothing matches that"
              description="Try fewer words, or clear the filters."
              action={
                <Button asChild variant="secondary">
                  <Link href={routes.organisations.content.index(orgId)}>Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">
                {formatNumber(drafts.length)} {drafts.length === 1 ? "draft" : "drafts"}
                {isFiltered ? " matching your filters" : ""}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {drafts.map((draft) => (
                  <DraftCard key={draft.id} organisationId={orgId} draft={draft} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
