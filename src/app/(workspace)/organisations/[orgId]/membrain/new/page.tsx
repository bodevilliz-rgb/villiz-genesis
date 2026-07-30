import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { listCategories, listTags } from "@/core/application/use-cases/membrain";
import { PageHeader } from "@/components/common/page-header";
import { EntryForm } from "@/components/membrain/entry-form";
import { Card, CardContent } from "@/components/ui/card";
import { canWriteContent } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

export default async function NewEntryPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await requireContext();

  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const viewerRole = await context.organisations.viewerRole(orgId);
  if (!canWriteContent(context.actor, viewerRole)) redirect(routes.organisations.membrain.index(orgId));

  const deps = { actor: context.actor, membrain: context.membrain, organisations: context.organisations };
  const [categories, tags] = await Promise.all([listCategories(deps, orgId), listTags(deps, orgId)]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="MemBrain"
        title="Add knowledge"
        description="Write it once, properly. Everything generated for this client from now on is shaped by what you put here."
      />
      <Card>
        <CardContent className="py-6">
          <EntryForm
            organisationId={orgId}
            categories={categories}
            tagSuggestions={tags.map((t) => t.name)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
