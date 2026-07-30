import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { TeamManager } from "@/components/organisations/team-manager";
import { canEditOrganisation } from "@/core/domain/entities/identity";

export default async function OrganisationTeamPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await requireContext();

  const [organisation, members, staff, viewerRole] = await Promise.all([
    context.organisations.findById(orgId),
    context.organisations.listMembers(orgId),
    context.identity.listActiveStaff(),
    context.organisations.viewerRole(orgId),
  ]);

  if (!organisation) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Who at Villiz works on this account, and what each of them can change."
      />
      <TeamManager
        organisationId={orgId}
        members={members}
        staff={staff}
        canManage={canEditOrganisation(context.actor, viewerRole)}
      />
    </div>
  );
}
