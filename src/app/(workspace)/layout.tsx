import Link from "next/link";
import { redirect } from "next/navigation";
import { requireContext } from "@/server/container";
import { SidebarNav, type NavItem } from "@/components/shell/sidebar-nav";
import { MobileNav } from "@/components/shell/mobile-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { OrganisationSwitcher } from "@/components/shell/organisation-switcher";
import { routes } from "@/lib/routes";

/**
 * Application shell.
 *
 * Roadmap destinations remain represented in configuration but are excluded
 * from the production navigation until they have a legitimate workspace.
 *
 * `icon` is a serializable string key (not a component reference) — this is
 * a Server Component, and `NavItem[]` crosses into the Client Component
 * `SidebarNav` as a prop, so it must stay plain data. `SidebarNav` resolves
 * the actual lucide-react icon component itself via its own `iconMap`.
 */
const MISSION_NAV: NavItem[] = [
  { href: routes.dashboard, label: "Mission Control", icon: "dashboard" },
  { href: "#inbox", label: "Inbox", icon: "inbox", disabled: true, note: "Soon", showInPrimaryNavigation: false },
  { href: "#notifications", label: "Notifications", icon: "bell", disabled: true, note: "Soon", showInPrimaryNavigation: false },
];

const OPERATIONS_NAV: NavItem[] = [
  { href: routes.organisations.index, label: "Clients", icon: "building", prefix: true },
  { href: "#projects", label: "Projects", icon: "folders", disabled: true, note: "Soon", showInPrimaryNavigation: false },
  { href: "#creative", label: "Creative", icon: "pen-line", disabled: true, note: "Soon", showInPrimaryNavigation: false },
  { href: routes.review, label: "Reviews", icon: "check-circle" },
  { href: routes.publishing, label: "Publishing", icon: "calendar-clock" },
];

const BUSINESS_NAV: NavItem[] = [
  { href: routes.analytics, label: "Analytics", icon: "bar-chart" },
  { href: "#finance", label: "Finance", icon: "wallet", disabled: true, note: "Soon", showInPrimaryNavigation: false },
];

const INTELLIGENCE_NAV: NavItem[] = [
  { href: routes.awo, label: "Awo", icon: "sparkles" },
];

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const context = await requireContext();

  // An account can be created but not yet activated by an administrator.
  if (!context.actor.isActive) redirect(routes.login);

  const organisations = await context.organisations.listForActor();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-1 border-r border-border bg-surface/90 px-4 py-5 backdrop-blur-xl lg:flex">
        <Link href={routes.dashboard} className="mb-3 flex min-h-11 items-center gap-2.5 px-2">
          <span aria-hidden className="size-3 rounded-full bg-[linear-gradient(135deg,var(--primary),var(--signal-violet))] shadow-[0_0_0_5px_var(--primary-soft)]" />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Villiz Social
          </span>
        </Link>

        <OrganisationSwitcher organisations={organisations} canCreate={context.actor.isPlatformAdmin} />

        <div className="mt-3 flex-1 overflow-y-auto space-y-4">
          <SidebarNav items={MISSION_NAV} label="Mission" />
          <SidebarNav items={OPERATIONS_NAV} label="Operations" />
          <SidebarNav items={BUSINESS_NAV} label="Business" />
          <SidebarNav items={INTELLIGENCE_NAV} label="Intelligence" />
        </div>

        <div className="border-t border-border pt-2">
          <SidebarNav items={[
            ...(context.actor.isPlatformAdmin ? [{ href: routes.team, label: "Team", icon: "users" as const }] : []),
            { href: routes.settings, label: "Settings", icon: "settings" },
          ]} label="System" />
          <UserMenu actor={context.actor} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-2 py-2 backdrop-blur-xl lg:hidden">
          <div className="flex min-w-0 items-center gap-1">
            <MobileNav
              navGroups={[
                { label: "Mission", items: MISSION_NAV },
                { label: "Operations", items: OPERATIONS_NAV },
                { label: "Business", items: BUSINESS_NAV },
                { label: "Intelligence", items: INTELLIGENCE_NAV },
                { label: "System", items: [
                  ...(context.actor.isPlatformAdmin ? [{ href: routes.team, label: "Team", icon: "users" as const }] : []),
                  { href: routes.settings, label: "Settings", icon: "settings" },
                ] },
              ]}
              organisations={organisations}
              canCreateOrganisation={context.actor.isPlatformAdmin}
            />
            <Link href={routes.dashboard} className="flex min-h-11 min-w-0 items-center gap-2 px-1">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[linear-gradient(135deg,var(--primary),var(--signal-violet))]" />
              <span className="truncate text-sm font-semibold text-foreground">
                Villiz Social
              </span>
            </Link>
          </div>
          <div className="w-40 shrink-0">
            <UserMenu actor={context.actor} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
