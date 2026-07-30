import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { OrganisationForm } from "@/components/organisations/organisation-form";
import { Card, CardContent } from "@/components/ui/card";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Add a client" };

export default async function NewOrganisationPage() {
  const context = await requireContext();

  // The database rejects this too. Redirecting keeps a non-admin out of a form
  // they can never submit, rather than letting them fill it in and fail.
  if (!context.actor.isPlatformAdmin) redirect(routes.organisations.index);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="Clients"
        title="Add a client account"
        description="Creating an account provisions its MemBrain taxonomy, guardrails and media storage. You become the account lead."
      />
      <Card>
        <CardContent className="py-6">
          <OrganisationForm />
        </CardContent>
      </Card>
    </div>
  );
}
