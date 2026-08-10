import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { canWriteContent } from "@/core/domain/entities/identity";
import { getPublishingAnalytics, listPublishingQueue } from "@/core/application/use-cases/publishing";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { PublishingAnalyticsSummary } from "@/components/publishing/publishing-analytics-summary";
import { PublishingJobRow } from "@/components/publishing/publishing-job-row";
import { Send } from "lucide-react";
import type { PublishingJob, PublishingPlatform, PublishingTriggerType } from "@/core/domain/entities/publishing";
import { PUBLISHING_PLATFORM_LABELS, PUBLISHING_TRIGGER_TYPE_LABELS } from "@/core/domain/entities/publishing";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { buildQueueUrl, type PublishingQueueSearch } from "@/lib/publishing-queue-url";
import { formatRequesterName } from "@/components/publishing/requester-name";

export const metadata: Metadata = { title: "Publishing Queue" };

type QueueTab = "queued" | "scheduled" | "publishing" | "awaiting_confirmation" | "failed" | "published" | "cancelled";

const TABS: { tab: QueueTab; label: string }[] = [
  { tab: "queued", label: "Queued" },
  { tab: "scheduled", label: "Scheduled" },
  { tab: "publishing", label: "Publishing" },
  { tab: "awaiting_confirmation", label: "Awaiting Confirmation" },
  { tab: "failed", label: "Failed" },
  { tab: "published", label: "Published" },
  { tab: "cancelled", label: "Cancelled" },
];

const TRIGGER_TYPES: PublishingTriggerType[] = ["immediate", "scheduled", "retry"];

type QueueSearch = PublishingQueueSearch;

function isDue(job: PublishingJob): boolean {
  return new Date(job.scheduledFor).getTime() <= Date.now();
}

function filterForTab(jobs: PublishingJob[], tab: QueueTab): PublishingJob[] {
  switch (tab) {
    case "queued":
      return jobs.filter((j) => j.status === "queued" && isDue(j));
    case "scheduled":
      return jobs.filter((j) => j.status === "queued" && !isDue(j));
    case "publishing":
      return jobs.filter((j) => j.status === "processing");
    case "awaiting_confirmation":
      // P0 fix: a queue of its own, never folded into Failed — these posts
      // reached the provider and are simply unconfirmed.
      return jobs.filter((j) => j.status === "awaiting_confirmation");
    case "failed":
      return jobs.filter((j) => j.status === "failed");
    case "published":
      return jobs.filter((j) => j.status === "published");
    case "cancelled":
      return jobs.filter((j) => j.status === "cancelled");
  }
}

export default async function PublishingQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<QueueSearch>;
}) {
  const { orgId } = await params;
  const search = await searchParams;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const viewerRole = await context.organisations.viewerRole(orgId);
  const canWrite = context.actor.isPlatformAdmin || canWriteContent(context.actor, viewerRole);

  const deps = {
    actor: context.actor,
    publishing: context.publishing,
    blotatoAccounts: context.blotatoAccounts,
    content: context.content,
    organisations: context.organisations,
    audits: context.audits,
    notifications: context.notifications,
  };

  const activeTab = TABS.find((t) => t.tab === search.tab)?.tab ?? "queued";
  const platformFilter = (search.platform || undefined) as PublishingPlatform | undefined;
  const triggerTypeFilter = TRIGGER_TYPES.find((t) => t === search.triggerType);
  const searchText = search.q?.trim().toLowerCase() || undefined;
  const dateFrom = search.dateFrom ? new Date(`${search.dateFrom}T00:00:00.000Z`).toISOString() : undefined;
  const dateTo = search.dateTo ? new Date(`${search.dateTo}T23:59:59.999Z`).toISOString() : undefined;

  const hasActiveFilters = Boolean(platformFilter || triggerTypeFilter || searchText || search.dateFrom || search.dateTo);

  const [allJobs, analytics] = await Promise.all([
    listPublishingQueue(deps, {
      organisationId: orgId,
      platform: platformFilter,
      triggerType: triggerTypeFilter,
      dateFrom,
      dateTo,
      limit: 200,
      offset: 0,
    }),
    getPublishingAnalytics(deps, orgId),
  ]);

  const tabbedJobs = filterForTab(allJobs, activeTab);

  const draftInfo = new Map<
    string,
    { title: string; campaign: { id: string; name: string } | null; scheduledTimezone: string | null }
  >();
  await Promise.all(
    [...new Set(tabbedJobs.map((j) => j.draftId))].map(async (draftId) => {
      const draft = await context.content.findDraft(orgId, draftId);
      draftInfo.set(draftId, {
        title: draft?.title ?? "Untitled draft",
        campaign: draft?.campaign ?? null,
        scheduledTimezone: draft?.scheduledTimezone ?? null,
      });
    }),
  );

  const attemptsByJob = new Map<string, Awaited<ReturnType<typeof context.publishing.listAttemptsForJob>>>();
  await Promise.all(
    tabbedJobs.map(async (job) => {
      attemptsByJob.set(job.id, await context.publishing.listAttemptsForJob(orgId, job.id));
    }),
  );

  // Title, campaign, and requester aren't columns on publishing_jobs itself
  // (they live on the joined draft/profile), so this search matches after the
  // fact against data already fetched above — never against the raw job row.
  const visibleJobs = searchText
    ? tabbedJobs.filter((job) => {
        const info = draftInfo.get(job.draftId);
        const haystack = [
          info?.title ?? "",
          info?.campaign?.name ?? "",
          formatRequesterName(job.requestedByProfile),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(searchText);
      })
    : tabbedJobs;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Villiz Social Manager"
        title="Publishing Queue"
        description="Every publish is driven automatically by the background worker — Queued → Publishing → Published or Failed. Nobody moves this by hand."
      />

      <PublishingAnalyticsSummary analytics={analytics} />

      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        {TABS.map(({ tab, label }) => (
          <Link
            key={tab}
            href={buildQueueUrl(orgId, search, { tab })}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <form
          action={routes.organisations.publishing.index(orgId)}
          method="get"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="tab" value={activeTab} />
          {platformFilter ? <input type="hidden" name="platform" value={platformFilter} /> : null}
          {triggerTypeFilter ? <input type="hidden" name="triggerType" value={triggerTypeFilter} /> : null}

          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Search
            <input
              type="search"
              name="q"
              defaultValue={search.q ?? ""}
              placeholder="Title, campaign, or requester"
              className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Queued from
            <input
              type="date"
              name="dateFrom"
              defaultValue={search.dateFrom ?? ""}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Queued to
            <input
              type="date"
              name="dateTo"
              defaultValue={search.dateTo ?? ""}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-border bg-muted px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted/80"
          >
            Apply filters
          </button>
          {hasActiveFilters ? (
            <Link
              href={buildQueueUrl(orgId, {}, { tab: activeTab })}
              className="text-[13px] font-medium text-primary hover:underline"
            >
              Clear filters
            </Link>
          ) : null}
        </form>

        <div className="flex flex-wrap gap-2">
          <Link
            href={buildQueueUrl(orgId, search, { platform: undefined })}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px]",
              !platformFilter ? "border-primary text-primary" : "border-border text-muted-foreground",
            )}
          >
            All platforms
          </Link>
          {(Object.keys(PUBLISHING_PLATFORM_LABELS) as PublishingPlatform[]).map((platform) => (
            <Link
              key={platform}
              href={buildQueueUrl(orgId, search, { platform })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px]",
                platformFilter === platform ? "border-primary text-primary" : "border-border text-muted-foreground",
              )}
            >
              {PUBLISHING_PLATFORM_LABELS[platform]}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={buildQueueUrl(orgId, search, { triggerType: undefined })}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px]",
              !triggerTypeFilter ? "border-primary text-primary" : "border-border text-muted-foreground",
            )}
          >
            All triggers
          </Link>
          {TRIGGER_TYPES.map((triggerType) => (
            <Link
              key={triggerType}
              href={buildQueueUrl(orgId, search, { triggerType })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px]",
                triggerTypeFilter === triggerType ? "border-primary text-primary" : "border-border text-muted-foreground",
              )}
            >
              {PUBLISHING_TRIGGER_TYPE_LABELS[triggerType]}
            </Link>
          ))}
        </div>
      </div>

      {visibleJobs.length === 0 ? (
        <EmptyState
          icon={<Send />}
          title={`No ${TABS.find((t) => t.tab === activeTab)?.label.toLowerCase()} publishes`}
          description={
            hasActiveFilters
              ? "No jobs match the current filters. Try clearing them."
              : "Publish or schedule an approved draft from Content Studio to see it appear here."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleJobs.map((job) => (
            <PublishingJobRow
              key={job.id}
              organisationId={orgId}
              job={job}
              draftTitle={draftInfo.get(job.draftId)?.title ?? "Untitled draft"}
              campaign={draftInfo.get(job.draftId)?.campaign ?? null}
              organisationName={organisation.name}
              scheduledTimezone={draftInfo.get(job.draftId)?.scheduledTimezone ?? null}
              attempts={attemptsByJob.get(job.id) ?? []}
              canWrite={canWrite}
            />
          ))}
        </div>
      )}
    </div>
  );
}
