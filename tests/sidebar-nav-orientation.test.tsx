// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarNav, type NavItem } from "@/components/shell/sidebar-nav";

/**
 * Sprint 8.0 regression test. SidebarNav always rendered a vertical
 * `flex-col` list — fine for the primary desktop sidebar, but the
 * organisation-scoped sub-nav (WorkspaceLayout's OrganisationLayout) wraps
 * it in an `overflow-x-auto`/`min-w-max` horizontal-scroller container that
 * only works if the nav itself lays its items out in a row. Before this
 * sprint, SidebarNav's hardcoded `flex-col` fought that container on every
 * organisation page, on both desktop and mobile — this asserts the new
 * `orientation` prop actually switches the layout direction, and that the
 * default stays exactly as it was for every other call site.
 */

const ITEMS: NavItem[] = [
  { href: "/organisations", label: "Clients", icon: "building" },
  { href: "/review", label: "Reviews", icon: "check-circle" },
];

describe("SidebarNav orientation", () => {
  it("defaults to a vertical (flex-col) layout, matching the desktop sidebar's original behaviour", () => {
    render(<SidebarNav items={ITEMS} />);
    const nav = screen.getByRole("navigation");
    expect(nav.className).toContain("flex-col");
    expect(nav.className).not.toContain("flex-row");
  });

  it('switches to a horizontal (flex-row) layout when orientation="horizontal"', () => {
    render(<SidebarNav items={ITEMS} orientation="horizontal" />);
    const nav = screen.getByRole("navigation");
    expect(nav.className).toContain("flex-row");
    expect(nav.className).not.toContain("flex-col");
  });

  it("still renders every item and its label regardless of orientation", () => {
    render(<SidebarNav items={ITEMS} orientation="horizontal" />);
    expect(screen.getByText("Clients")).toBeTruthy();
    expect(screen.getByText("Reviews")).toBeTruthy();
  });

  it("marks horizontal items shrink-0 and whitespace-nowrap so they never wrap or squash inside their scroll container", () => {
    render(<SidebarNav items={ITEMS} orientation="horizontal" />);
    const link = screen.getByText("Clients").closest("a");
    expect(link?.className).toContain("shrink-0");
    expect(link?.className).toContain("whitespace-nowrap");
  });
});
