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
import { DraftCard, type DraftPublishingSummary } from "@/components/content/draft-card";
import { KnowledgeCoverage } from "@/components/content/knowledge-coverage";
import { canWriteContent } from "@/core/domain/entities/identity";
import { CONTENT_DRAFT_STATUS_LABELS, type ContentDraftStatus } from "@/core/domain/entities/content";
import { contentDraftStatusSchema, contentDraftTypeSchema } from "@/core/application/dto/content-dto";
import { formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";
import { ContentCalendar } from "@/components/content/content-calendar";
import type { PublishingJob } from "@/core/domain/entities/publishing";
import { ContentPipelineBoard } from "@/components/content/content-pipeline-board";

/**
 * Derived from CONTENT_DRAFT_STATUS_LABELS's own declaration order (a
 * Record<ContentDraftStatus, string>, so every status is guaranteed present)
 * rather than a hand-maintained list — the previous hardcoded list omitted
 * needs_review, rejected, publishing, failed, and awaiting_client, so a
 * draft sitting in any of those statuses never got a Stat tile. Adding a
 * status to ContentDraftStatus without giving it a label is a compile
 * error, so this can't silently drift out of sync again.
 */
const STATUS_ORDER: ContentDraftStatus[] = Object.keys(CONTENT_DRAFT_STATUS_LABELS) as ContentDraftStatus[];

export default async function ContentStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ q?: string; status?: string; type?: string; author?: string; view?: string }>;
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

  async function fetchLatestJobForDraft(draftId: string): Promise<PublishingJob | null> {
    const jobs = await context.publishing.listJobsForDraft(orgId, draftId);
    return jobs.reduce<PublishingJob | null>(
      (latest, job) => (!latest || new Date(job.createdAt) > new Date(latest.createdAt) ? job : latest),
      null,
    );
  }

  const queueDrafts = drafts.filter((d) => ["scheduled", "publishing", "failed", "published"].includes(d.status));
  const queuePublishingByDraftId = new Map<string, DraftPublishingSummary>();
  if (filters.view === "queue") {
    await Promise.all(
      queueDrafts.map(async (draft) => {
        const latestJob = await fetchLatestJobForDraft(draft.id);
        if (!latestJob) return;

        const attempts = await context.publishing.listAttemptsForJob(orgId, latestJob.id);
        const latestAttempt = attempts.reduce<(typeof attempts)[number] | null>(
          (latest, attempt) => (!latest || attempt.attemptNumber > latest.attemptNumber ? attempt : latest),
          null,
        );

        queuePublishingByDraftId.set(draft.id, {
          job: latestJob,
          latestErrorMessage: latestAttempt?.status === "failed" ? latestAttempt.errorMessage : null,
          mockUrl: latestAttempt?.status === "completed" ? latestAttempt.externalUrl : null,
        });
      }),
    );
  }

  const calendarJobsByDraftId: Record<string, PublishingJob> = {};
  if (filters.view === "calendar") {
    const scheduledDrafts = drafts.filter((d) => d.scheduledAt !== null);
    await Promise.all(
      scheduledDrafts.map(async (draft) => {
        const latestJob = await fetchLatestJobForDraft(draft.id);
        if (latestJob) calendarJobsByDraftId[draft.id] = latestJob;
      }),
    );
  }

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

      {/* View Tab Switcher */}
      <div className="flex gap-2 border-b border-border pb-3">
        <Button asChild variant={(!filters.view || filters.view === "list") ? "primary" : "secondary"} size="sm">
          <Link href={`/organisations/${orgId}/content?view=list`}>List View</Link>
        </Button>
        <Button asChild variant={filters.view === "calendar" ? "primary" : "secondary"} size="sm">
          <Link href={`/organisations/${orgId}/content?view=calendar`}>Content Calendar</Link>
        </Button>
        <Button asChild variant={filters.view === "board" ? "primary" : "secondary"} size="sm">
          <Link href={`/organisations/${orgId}/content?view=board`}>Content Pipeline</Link>
        </Button>
        <Button asChild variant={filters.view === "queue" ? "primary" : "secondary"} size="sm">
          <Link href={`/organisations/${orgId}/content?view=queue`}>Publishing Queue</Link>
        </Button>
      </div>

      {filters.view === "calendar" ? (
        <ContentCalendar drafts={drafts} organisationId={orgId} jobsByDraftId={calendarJobsByDraftId} />
      ) : filters.view === "board" ? (
        <ContentPipelineBoard initialDrafts={drafts} organisationId={orgId} />
      ) : filters.view === "queue" ? (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">
            Publishing Queue
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {queueDrafts.length === 0 ? (
              <p className="text-sm text-muted-foreground col-span-full">No items in the publishing queue.</p>
            ) : (
              queueDrafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  organisationId={orgId}
                  draft={draft}
                  publishing={queuePublishingByDraftId.get(draft.id) ?? null}
                />
              ))
            )}
          </div>
        </div>
      ) : !hasAnyDrafts ? (
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
