import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { OrganisationForm } from "@/components/organisations/organisation-form";
import { LimitsForm } from "@/components/organisations/limits-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canEditOrganisation } from "@/core/domain/entities/identity";

export default async function OrganisationSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const context = await requireContext();

  const [organisation, viewerRole, usage] = await Promise.all([
    context.organisations.findById(orgId),
    context.organisations.viewerRole(orgId),
    context.usage.forOrganisation(orgId),
  ]);

  if (!organisation) notFound();
  const canEdit = canEditOrganisation(context.actor, viewerRole);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" description="The client record and the limits this account operates within." />

      <Card>
        <CardHeader>
          <CardTitle>Client details</CardTitle>
          <CardDescription>
            {canEdit
              ? "Changes apply immediately across the platform."
              : "Only the account lead or a platform administrator can change these."}
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          {canEdit ? (
            <OrganisationForm organisation={organisation} />
          ) : (
            <p className="text-[13px] text-muted-foreground">
              You have read access to this account. Ask the account lead if something here needs to change.
            </p>
          )}
        </CardContent>
      </Card>

      {usage ? (
        <Card>
          <CardHeader>
            <CardTitle>Guardrails</CardTitle>
            <CardDescription>
              {context.actor.isPlatformAdmin
                ? "Limits are enforced by the database, not just displayed here."
                : "Limits are set by platform administrators."}
            </CardDescription>
          </CardHeader>
          <CardContent className="py-6">
            {context.actor.isPlatformAdmin ? (
              <LimitsForm organisationId={orgId} usage={usage} />
            ) : (
              <p className="text-[13px] text-muted-foreground">
                This account is limited to {usage.maxSocialAccounts} channels, {usage.maxPostsPerWeek} posts per week
                and {usage.maxMembrainEntries} MemBrain entries.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
