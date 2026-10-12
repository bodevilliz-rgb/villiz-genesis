"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Blocks,
  Brain,
  Building2,
  CalendarClock,
  CheckCircle2,
  Images,
  LayoutDashboard,
  LayoutList,
  PenLine,
  Settings2,
  Users,
  Inbox,
  Bell,
  Folders,
  BarChart3,
  Wallet,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type IconName =
  | "dashboard"
  | "building"
  | "pen-line"
  | "blocks"
  | "calendar-clock"
  | "images"
  | "settings"
  | "layout-list"
  | "brain"
  | "users"
  | "check-circle"
  | "inbox"
  | "bell"
  | "folders"
  | "bar-chart"
  | "wallet"
  | "sparkles"
  | "trending-up";

const iconMap: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  building: Building2,
  "pen-line": PenLine,
  blocks: Blocks,
  "calendar-clock": CalendarClock,
  images: Images,
  settings: Settings2,
  "layout-list": LayoutList,
  brain: Brain,
  users: Users,
  "check-circle": CheckCircle2,
  inbox: Inbox,
  bell: Bell,
  folders: Folders,
  "bar-chart": BarChart3,
  wallet: Wallet,
  sparkles: Sparkles,
  "trending-up": TrendingUp,
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Match nested routes, e.g. every page under an organisation. */
  prefix?: boolean;
  disabled?: boolean;
  note?: string;
  /** Keep roadmap configuration without exposing the destination in production navigation. */
  showInPrimaryNavigation?: boolean;
}

/**
 * The active item is marked with a hairline orange rail rather than a filled
 * pill. It reads as an anchored position in a tool you live in, and it keeps
 * the accent doing exactly one job across the whole product.
 *
 * `orientation="horizontal"` (Sprint 8.0) is for reuse as a scrollable tab
 * row (e.g. the organisation-scoped sub-nav) — the default stays
 * "vertical" so every existing call site (the primary sidebar, the mobile
 * drawer) is completely unaffected.
 */
export function SidebarNav({
  items,
  label,
  orientation = "vertical",
}: {
  items: NavItem[];
  label?: string;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const horizontal = orientation === "horizontal";
  const visibleItems = items.filter((item) => item.showInPrimaryNavigation !== false);

  if (visibleItems.length === 0) return null;

  return (
    <nav aria-label={label ?? "Primary"} className={cn("flex gap-0.5", horizontal ? "flex-row items-center" : "flex-col")}>
      {label ? (
        <p className="px-3 pb-1 pt-3 text-xs font-semibold text-subtle-foreground">
          {label}
        </p>
      ) : null}

      {visibleItems.map((item) => {
        const active = item.prefix ? pathname.startsWith(item.href) : pathname === item.href;
        const Icon = iconMap[item.icon];

        if (item.disabled) {
          return (
            <span
              key={item.href}
              title={item.note}
              aria-disabled
              className={cn(
                "flex min-h-11 cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-subtle-foreground/60",
                horizontal && "shrink-0 whitespace-nowrap",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
              {item.note ? (
                <span className="ml-auto font-mono text-[10px] uppercase tracking-wider">{item.note}</span>
              ) : null}
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
              horizontal && "shrink-0 whitespace-nowrap",
              active
                ? "bg-[linear-gradient(135deg,rgba(255,122,26,0.18),rgba(139,92,246,0.18))] font-semibold text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {active ? (
              <span
                aria-hidden
                className={cn(
                  "absolute rounded-full bg-primary",
                  horizontal ? "inset-x-1.5 bottom-0 h-0.5" : "inset-y-1.5 left-0 w-0.5",
                )}
              />
            ) : null}
            <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
