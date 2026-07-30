"use client";
import { useRouter } from "next/navigation";
import { Building2, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OrganisationSummary } from "@/core/domain/entities/organisation";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Client context switcher. Operators move between accounts dozens of times a
 * day, so this sits at the top of the sidebar and keeps the current client
 * visible at all times — mis-posting to the wrong client is the single most
 * expensive mistake this product can allow.
 */
export function OrganisationSwitcher({
  organisations,
  current,
  canCreate,
}: {
  organisations: OrganisationSummary[];
  current?: { id: string; name: string; brandColour: string | null } | null;
  canCreate: boolean;
}) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-card-hover",
        )}
      >
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded"
          style={{ backgroundColor: current?.brandColour ?? "var(--muted)" }}
        >
          <Building2 className="size-3.5 text-foreground/80" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{current?.name ?? "All clients"}</span>
          <span className="block text-[11px] text-subtle-foreground">
            {organisations.length} {organisations.length === 1 ? "account" : "accounts"}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Client accounts</DropdownMenuLabel>
        <div className="max-h-72 overflow-y-auto">
          {organisations.length === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-subtle-foreground">No accounts assigned to you yet.</p>
          ) : (
            organisations.map((organisation) => (
              <DropdownMenuItem
                key={organisation.id}
                onSelect={() => router.push(routes.organisations.detail(organisation.id))}
                className={cn(organisation.id === current?.id && "text-foreground")}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: organisation.brandColour ?? "var(--border-strong)" }}
                />
                <span className="truncate">{organisation.name}</span>
              </DropdownMenuItem>
            ))
          )}
        </div>
        {canCreate ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push(routes.organisations.new)}>
              <Plus aria-hidden />
              Add a client
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
