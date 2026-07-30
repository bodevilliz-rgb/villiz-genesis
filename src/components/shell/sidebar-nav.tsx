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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * String keys only — never a component/function reference — so `NavItem[]`
 * built in a Server Component (see the workspace and organisation layouts)
 * stays a plain, serializable data structure. The actual icon component is
 * resolved from `iconMap` below, entirely inside this Client Component.
 */
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
  | "check-circle";

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
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Match nested routes, e.g. every page under an organisation. */
  prefix?: boolean;
  disabled?: boolean;
  note?: string;
}

/**
 * The active item is marked with a hairline orange rail rather than a filled
 * pill. It reads as an anchored position in a tool you live in, and it keeps
 * the accent doing exactly one job across the whole product.
 */
export function SidebarNav({ items, label }: { items: NavItem[]; label?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label ?? "Primary"} className="flex flex-col gap-0.5">
      {label ? (
        <p className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-subtle-foreground">
          {label}
        </p>
      ) : null}

      {items.map((item) => {
        const active = item.prefix ? pathname.startsWith(item.href) : pathname === item.href;
        const Icon = iconMap[item.icon];

        if (item.disabled) {
          return (
            <span
              key={item.href}
              title={item.note}
              aria-disabled
              className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] text-subtle-foreground/60"
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
              "relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {active ? (
              <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
            ) : null}
            <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
