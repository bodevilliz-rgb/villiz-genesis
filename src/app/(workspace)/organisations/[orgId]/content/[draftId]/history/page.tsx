import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireContext } from "@/server/container";
import { getDraft, listDraftVersions } from "@/core/application/use-cases/content";
import { PageHeader } from "@/components/common/page-header";
import { DraftVersionTimeline } from "@/components/content/draft-version-timeline";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export default async function DraftHistoryPage({
  params,
}: {
  params: Promise<{ orgId: string; draftId: string }>;
}) {
  const { orgId, draftId } = await params;
  const context = await requireContext();

  const deps = {
    actor: context.actor,
    content: context.content,
    membrain: context.membrain,
    organisations: context.organisations,
  };

  const draft = await getDraft(deps, orgId, draftId).catch(() => null);
  if (!draft) notFound();

  const versions = await listDraftVersions(deps, orgId, draftId);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="Content Studio"
        title={`History · ${draft.title}`}
        description="Every change to this draft, in order. Nothing here can be edited or deleted."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={routes.organisations.content.draft(orgId, draftId)}>
              <ArrowLeft aria-hidden />
              Back to draft
            </Link>
          </Button>
        }
      />
      <DraftVersionTimeline versions={versions} currentVersion={draft.version} />
    </div>
  );
}
