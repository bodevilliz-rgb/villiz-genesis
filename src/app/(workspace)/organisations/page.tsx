import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { OrganisationCard } from "@/components/organisations/organisation-card";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Clients" };

export default async function OrganisationsPage() {
  const context = await requireContext();
  const organisations = await context.organisations.listForActor();

  const grouped = {
    active: organisations.filter((o) => o.status === "active"),
    prospect: organisations.filter((o) => o.status === "prospect"),
    paused: organisations.filter((o) => o.status === "paused"),
    offboarded: organisations.filter((o) => o.status === "offboarded"),
  };

  const sections: Array<[string, typeof organisations]> = [
    ["Active", grouped.active],
    ["Prospects", grouped.prospect],
    ["Paused", grouped.paused],
    ["Offboarded", grouped.offboarded],
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Clients"
        title="Client accounts"
        description="Every organisation Villiz manages. Clients do not have access — this is our view of their work."
        actions={
          context.actor.isPlatformAdmin ? (
            <Button asChild variant="primary">
              <Link href={routes.organisations.new}>
                <Plus aria-hidden />
                Add a client
              </Link>
            </Button>
          ) : null
        }
      />

      {organisations.length === 0 ? (
        <EmptyState
          icon={<Building2 aria-hidden />}
          title="No accounts to show"
          description={
            context.actor.isPlatformAdmin
              ? "Add the first client and Project Genesis will provision their MemBrain and guardrails automatically."
              : "You have not been assigned to a client account yet."
          }
          action={
            context.actor.isPlatformAdmin ? (
              <Button asChild variant="primary">
                <Link href={routes.organisations.new}>Add a client</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        sections
          .filter(([, items]) => items.length > 0)
          .map(([label, items]) => (
            <section key={label} className="flex flex-col gap-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">
                {label} · {items.length}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((organisation) => (
                  <OrganisationCard key={organisation.id} organisation={organisation} />
                ))}
              </div>
            </section>
          ))
      )}
    </div>
  );
}
