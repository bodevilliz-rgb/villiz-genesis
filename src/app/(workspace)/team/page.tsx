import { notFound } from "next/navigation";
import { requireContext } from "@/server/container";
import { listStaffAdmin } from "@/server/staff-admin";
import { StaffManager } from "@/components/team/staff-manager";
import { PageHeader } from "@/components/common/page-header";

export default async function TeamPage() {
  const context = await requireContext();
  if (!context.actor.isPlatformAdmin) notFound();
  const [staff, organisations] = await Promise.all([listStaffAdmin(context.actor.id), context.organisations.listForActor()]);
  return <div className="flex flex-col gap-6"><PageHeader title="Team" description="Invite staff, assign roles and control which client accounts they can access."/><StaffManager staff={staff} organisations={organisations}/></div>;
}
