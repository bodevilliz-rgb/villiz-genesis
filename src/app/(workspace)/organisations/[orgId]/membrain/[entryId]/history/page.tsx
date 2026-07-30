import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireContext } from "@/server/container";
import { getEntry, listEntryVersions } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { VersionTimeline } from "@/components/membrain/version-timeline";
import { Button } from "@/components/ui/button";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

export default async function EntryHistoryPage({
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
  const versions = await listEntryVersions(deps, orgId, entryId);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="MemBrain"
        title={`History · ${entry.title}`}
        description="Every change to this knowledge, in order. Nothing here can be edited or deleted."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={routes.organisations.membrain.entry(orgId, entryId)}>
              <ArrowLeft aria-hidden />
              Back to entry
            </Link>
          </Button>
        }
      />
      <VersionTimeline
        organisationId={orgId}
        entryId={entryId}
        versions={versions}
        currentVersion={entry.version}
        canRestore={canWriteContent(context.actor, viewerRole)}
      />
    </div>
  );
}
