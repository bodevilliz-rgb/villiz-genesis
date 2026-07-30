import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { getEntry, listCategories, listTags } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { EntryForm } from "@/components/membrain/entry-form";
import { Card, CardContent } from "@/components/ui/card";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

export default async function EditEntryPage({
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
  if (!canWriteContent(context.actor, viewerRole)) {
    redirect(routes.organisations.membrain.entry(orgId, entryId));
  }

  const [categories, tags] = await Promise.all([listCategories(deps, orgId), listTags(deps, orgId)]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow={`MemBrain · v${entry.version}`}
        title="Edit knowledge"
        description="Saving creates a new version. The previous one stays in the record, with your reason attached."
      />
      <Card>
        <CardContent className="py-6">
          <EntryForm
            organisationId={orgId}
            categories={categories}
            tagSuggestions={tags.map((t) => t.name)}
            entry={entry}
          />
        </CardContent>
      </Card>
    </div>
  );
}
