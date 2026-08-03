// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MobileNav } from "@/components/shell/mobile-nav";
import type { OrganisationSummary } from "@/core/domain/entities/organisation";

// MobileNav's drawer renders OrganisationSwitcher, which calls useRouter() —
// outside a real Next.js app there is no AppRouterContext to satisfy that,
// so it throws "invariant expected app router to be mounted". Stub the
// pieces of next/navigation actually used (usePathname drives MobileNav's
// own auto-close-on-navigate effect); nothing else in this file needs a
// real router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * Sprint 8.0 mobile responsiveness fix regression test. Before this sprint,
 * the mobile nav was a `lg:hidden` block rendered permanently expanded,
 * inline, above every page's content — no way to collapse it, and it never
 * included the organisation switcher (the only way to change client
 * account) at all. This is now a proper Radix Dialog-based slide-in drawer,
 * reusing the same nav data and organisation switcher the desktop sidebar
 * already has.
 */

const NAV_GROUPS = [
  { label: "Mission", items: [{ href: "/dashboard", label: "Mission Control", icon: "dashboard" as const }] },
  { label: "Operations", items: [{ href: "/review", label: "Reviews", icon: "check-circle" as const }] },
];

function organisations(): OrganisationSummary[] {
  return [
    {
      id: "org-1",
      name: "Villiz Pixels",
      slug: "villiz-pixels",
      legalName: null,
      industry: null,
      websiteUrl: null,
      status: "active",
      brandColour: "#ff6a00",
      primaryContactName: null,
      primaryContactEmail: null,
      notes: null,
      onboardedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      viewerRole: "lead",
      memberCount: 3,
      membrainEntryCount: 10,
    },
  ];
}

describe("MobileNav", () => {
  it("is closed by default — nav content is not present until opened", () => {
    render(<MobileNav navGroups={NAV_GROUPS} organisations={organisations()} canCreateOrganisation={false} />);
    expect(screen.getByLabelText("Open navigation menu")).toBeTruthy();
    expect(screen.queryByText("Mission Control")).toBeNull();
  });

  it("opens the drawer and shows nav items and the organisation switcher when the hamburger is clicked", () => {
    render(<MobileNav navGroups={NAV_GROUPS} organisations={organisations()} canCreateOrganisation={false} />);

    fireEvent.click(screen.getByLabelText("Open navigation menu"));

    expect(screen.getByText("Mission Control")).toBeTruthy();
    expect(screen.getByText("Reviews")).toBeTruthy();
    // The organisation switcher — previously entirely absent from mobile —
    // must be reachable from inside the drawer. Its trigger shows "All
    // clients" (no organisation is pre-selected) plus the account count;
    // "Villiz Pixels" itself only appears once the dropdown is opened.
    expect(screen.getByText("All clients")).toBeTruthy();
    expect(screen.getByText("1 account")).toBeTruthy();
  });

  it("closes the drawer when the close button is clicked", () => {
    render(<MobileNav navGroups={NAV_GROUPS} organisations={organisations()} canCreateOrganisation={false} />);

    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    expect(screen.getByText("Mission Control")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Close navigation menu"));
    expect(screen.queryByText("Mission Control")).toBeNull();
  });

  it("shows every nav group passed in, not just the first", () => {
    render(<MobileNav navGroups={NAV_GROUPS} organisations={organisations()} canCreateOrganisation={false} />);
    fireEvent.click(screen.getByLabelText("Open navigation menu"));

    expect(screen.getByText("Mission")).toBeTruthy();
    expect(screen.getByText("Operations")).toBeTruthy();
  });
});
