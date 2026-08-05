import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { SetupWizard } from "./setup-wizard";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Genesis Setup Assistant" };

export default async function SetupAssistantPage() {
  const context = await requireContext();

  if (!context.actor.isPlatformAdmin) redirect(routes.organisations.index);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="Setup Assistant"
        title="Genesis Setup Assistant"
        description="Answer five sets of questions and Genesis will create the client account, populate MemBrain with brand knowledge, build a prompt library, and generate a Week 1 content calendar — all in one step."
      />
      <SetupWizard />
    </div>
  );
}
