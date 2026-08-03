"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { OrganisationSwitcher } from "./organisation-switcher";
import type { OrganisationSummary } from "@/core/domain/entities/organisation";
import { routes } from "@/lib/routes";

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * Sprint 8.0 mobile responsiveness fix. Below `lg`, the desktop `<aside>` in
 * WorkspaceLayout is hidden — this is what replaces it. Before this sprint,
 * a `lg:hidden` block rendered every nav item permanently expanded, inline,
 * above the page content: no way to collapse it, and it never included the
 * organisation switcher at all (a real gap — this is a multi-client agency
 * tool, and there was no way to change client account from a phone).
 *
 * A proper slide-in drawer instead, reusing the exact same SidebarNav and
 * OrganisationSwitcher components/styling the desktop sidebar already
 * uses — same visual identity, just an overlay instead of a permanent block.
 */
export function MobileNav({
  navGroups,
  organisations,
  canCreateOrganisation,
}: {
  navGroups: NavGroup[];
  organisations: OrganisationSummary[];
  canCreateOrganisation: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close automatically when a nav Link actually navigates somewhere new.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label="Open navigation menu"
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)] backdrop-blur-[2px] lg:hidden" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 left-0 z-50 flex h-dvh w-[85vw] max-w-72 flex-col gap-1 overflow-y-auto border-r border-border bg-surface px-3 py-4 shadow-2xl animate-in-fast lg:hidden"
        >
          <DialogPrimitive.Title className="sr-only">Navigation menu</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Client account switcher and primary navigation.
          </DialogPrimitive.Description>

          <div className="mb-3 flex items-center justify-between px-2">
            <Link href={routes.dashboard} className="flex items-center gap-2.5">
              <span aria-hidden className="size-2.5 rounded-full bg-primary" />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Villiz Social
              </span>
            </Link>
            <DialogPrimitive.Close
              aria-label="Close navigation menu"
              className="flex size-11 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <OrganisationSwitcher organisations={organisations} canCreate={canCreateOrganisation} />

          <div className="mt-3 flex-1 space-y-4">
            {navGroups.map((group, index) => (
              <SidebarNav key={group.label ?? index} items={group.items} label={group.label} />
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
