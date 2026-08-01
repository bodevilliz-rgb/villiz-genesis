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
import type { PublishingJob, PublishingPlatform } from "@/core/domain/entities/publishing";
import { PUBLISHING_PLATFORM_LABELS } from "@/core/domain/entities/publishing";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Publishing Queue" };

type QueueTab = "queued" | "scheduled" | "publishing" | "failed" | "published" | "cancelled";

const TABS: { tab: QueueTab; label: string }[] = [
  { tab: "queued", label: "Queued" },
  { tab: "scheduled", label: "Scheduled" },
  { tab: "publishing", label: "Publishing" },
  { tab: "failed", label: "Failed" },
  { tab: "published", label: "Published" },
  { tab: "cancelled", label: "Cancelled" },
];

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
  searchParams: Promise<{ tab?: string; platform?: string }>;
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
    content: context.content,
    organisations: context.organisations,
    audits: context.audits,
    notifications: context.notifications,
  };

  const activeTab = TABS.find((t) => t.tab === search.tab)?.tab ?? "queued";
  const platformFilter = (search.platform || undefined) as PublishingPlatform | undefined;

  const [allJobs, analytics] = await Promise.all([
    listPublishingQueue(deps, { organisationId: orgId, platform: platformFilter, limit: 200, offset: 0 }),
    getPublishingAnalytics(deps, orgId),
  ]);

  const tabbedJobs = filterForTab(allJobs, activeTab);

  const draftTitles = new Map<string, string>();
  await Promise.all(
    [...new Set(tabbedJobs.map((j) => j.draftId))].map(async (draftId) => {
      const draft = await context.content.findDraft(orgId, draftId);
      draftTitles.set(draftId, draft?.title ?? "Untitled draft");
    }),
  );

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
            href={`${routes.organisations.publishing.index(orgId)}?tab=${tab}${platformFilter ? `&platform=${platformFilter}` : ""}`}
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

      <div className="flex flex-wrap gap-2">
        <Link
          href={`${routes.organisations.publishing.index(orgId)}?tab=${activeTab}`}
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
            href={`${routes.organisations.publishing.index(orgId)}?tab=${activeTab}&platform=${platform}`}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px]",
              platformFilter === platform ? "border-primary text-primary" : "border-border text-muted-foreground",
            )}
          >
            {PUBLISHING_PLATFORM_LABELS[platform]}
          </Link>
        ))}
      </div>

      {tabbedJobs.length === 0 ? (
        <EmptyState
          icon={<Send />}
          title={`No ${TABS.find((t) => t.tab === activeTab)?.label.toLowerCase()} publishes`}
          description="Publish or schedule an approved draft from Content Studio to see it appear here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {tabbedJobs.map((job) => (
            <PublishingJobRow
              key={job.id}
              organisationId={orgId}
              job={job}
              draftTitle={draftTitles.get(job.draftId) ?? "Untitled draft"}
              canWrite={canWrite}
            />
          ))}
        </div>
      )}
    </div>
  );
}
