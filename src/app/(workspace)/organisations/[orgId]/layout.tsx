import { notFound } from "next/navigation";
import Link from "next/link";
import { requireContext } from "@/server/container";
import { OrganisationStatusBadge } from "@/components/common/status-badge";
import { SidebarNav, type NavItem } from "@/components/shell/sidebar-nav";
import { ORGANISATION_ROLE_LABELS } from "@/core/domain/entities/identity";
import { Badge } from "@/components/ui/badge";
import { routes } from "@/lib/routes";

export default async function OrganisationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const context = await requireContext();

  // RLS returns nothing for an account this employee is not on, so an
  // unauthorised id and a deleted id are indistinguishable — which is exactly
  // the behaviour we want. Neither confirms the account exists.
  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const viewerRole = await context.organisations.viewerRole(orgId);

  // `icon` is a serializable string key, not a component reference — see
  // the comment on `NavItem` in sidebar-nav.tsx for why.
  const nav: NavItem[] = [
    { href: routes.organisations.detail(orgId), label: "Overview", icon: "layout-list" },
    { href: routes.organisations.membrain.index(orgId), label: "MemBrain", icon: "brain", prefix: true },
    { href: routes.organisations.content.index(orgId), label: "Content Studio", icon: "pen-line", prefix: true },
    { href: routes.organisations.campaigns.index(orgId), label: "Campaigns", icon: "blocks", prefix: true },
    { href: routes.organisations.media.index(orgId), label: "Media Library", icon: "images", prefix: true },
    { href: routes.organisations.publishing.index(orgId), label: "Publishing Queue", icon: "bar-chart", prefix: true },
    { href: routes.organisations.team(orgId), label: "Team", icon: "users" },
    { href: routes.organisations.settings(orgId), label: "Settings", icon: "settings" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: organisation.brandColour ?? "var(--border-strong)" }}
          />
          <h1 className="text-lg font-semibold tracking-tight">{organisation.name}</h1>
          <OrganisationStatusBadge status={organisation.status} />
          {viewerRole ? <Badge tone="muted">{ORGANISATION_ROLE_LABELS[viewerRole]}</Badge> : null}
          {organisation.websiteUrl ? (
            <Link
              href={organisation.websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {organisation.websiteUrl.replace(/^https?:\/\//, "")}
            </Link>
          ) : null}
        </div>

        <div className="-mx-1 overflow-x-auto">
          <div className="flex min-w-max gap-1 px-1">
            <SidebarNav items={nav} />
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
