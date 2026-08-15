// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ClientIntelligence,
  EngagementIntelligenceBoundary,
  OperationalIntelligencePanel,
  SocialPriorities,
  type AwoPriority,
} from "@/components/awo/social-intelligence-workspace";
import { buildExecutiveAttention } from "@/components/dashboard/executive-attention";
import type { ClientSocialIntelligence } from "@/core/domain/entities/dashboard";
import { routes } from "@/lib/routes";

const root = resolve(__dirname, "..");

describe("Awo social intelligence boundary", () => {
  it("is an authenticated Genesis read path using existing dashboard and publishing intelligence", async () => {
    const page = await readFile(resolve(root, "src/app/(workspace)/awo/page.tsx"), "utf8");

    expect(page).toContain("requireContext()");
    expect(page).toContain("getDashboardHome(");
    expect(page).toContain("getPublishingAnalyticsForActor(");
    expect(page).toContain("Awo interprets current social-operation signals, explains why they matter, and directs you to the appropriate Genesis workspace.");
    expect(page).not.toMatch(/getAIProvider|generateText|generateObject|service[_-]?role/i);
    expect(page).not.toMatch(/gmail|calendar|daily_briefs|executive_users|google_oauth|playbooks/i);
  });

  it("exposes a real /awo route in both desktop and mobile navigation", async () => {
    const layout = await readFile(resolve(root, "src/app/(workspace)/layout.tsx"), "utf8");

    expect(routes.awo).toBe("/awo");
    expect(layout).toContain('{ href: routes.awo, label: "Awo", icon: "sparkles" }');
    expect(layout).not.toContain('href: "#awo"');
  });

  it("states the content-level engagement-intelligence boundary in product language", () => {
    render(<EngagementIntelligenceBoundary />);
    expect(screen.getByText("Engagement intelligence is currently available at content level.")).toBeInTheDocument();
    expect(screen.getByText(/Open an individual content draft to review its recommendations/i)).toBeInTheDocument();
  });
});

describe("Awo priority ordering and empty state", () => {
  it("orders failures, reviews, then all real readiness signals", () => {
    const items = buildExecutiveAttention({
      failedPublications: 2,
      reviewsRequiringApproval: 1,
      publishingHref: "/publishing?tab=failed",
      reviewHref: "/review",
      readinessItems: [
        { title: "Client knowledge", detail: "Knowledge needs attention.", href: "/organisations/one/membrain", actionLabel: "Open MemBrain" },
        { title: "Campaign readiness", detail: "Campaign needs attention.", href: "/organisations/one/campaigns/two", actionLabel: "Open campaign" },
      ],
    });

    expect(items.map((item) => item.kind)).toEqual(["failure", "review", "readiness", "readiness"]);
    expect(items.map((item) => item.href)).toEqual([
      "/publishing?tab=failed",
      "/review",
      "/organisations/one/membrain",
      "/organisations/one/campaigns/two",
    ]);
  });

  it("renders an honest empty state when no tracked signal needs attention", () => {
    const items = buildExecutiveAttention({
      failedPublications: 0,
      reviewsRequiringApproval: 0,
      publishingHref: "/publishing",
      reviewHref: "/review",
      readinessItems: [],
    });
    render(<SocialPriorities priorities={items as AwoPriority[]} />);
    expect(screen.getByText("No current social-operation priorities.")).toBeInTheDocument();
  });
});

describe("Awo authorised client and operational intelligence", () => {
  const clients = [{
    organisationId: "authorised-org",
    organisationName: "Authorised Client",
    membrainReadinessPercent: 42,
    activeCampaigns: [
      { campaignId: "ready-campaign", name: "Launch", readiness: { score: 60 } },
      { campaignId: "unavailable-campaign", name: "Unassessed", readiness: null },
    ],
  }] as unknown as ClientSocialIntelligence[];

  it("shows only supplied RLS-scoped clients, real readiness, and unavailable data honestly", () => {
    render(<ClientIntelligence clients={clients} membrainHref={(id) => `/organisations/${id}/membrain`} campaignHref={(id, campaignId) => `/organisations/${id}/campaigns/${campaignId}`} />);

    expect(screen.getByText("Authorised Client")).toBeInTheDocument();
    expect(screen.getByText("Portfolio intelligence")).toBeInTheDocument();
    expect(screen.queryByText("Hidden Client")).not.toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open MemBrain" })).toHaveAttribute("href", "/organisations/authorised-org/membrain");
  });

  it("presents real publishing and review values with links to existing workflows", () => {
    render(<OperationalIntelligencePanel intelligence={{
      failedPublications: 3,
      queuedPublications: 4,
      processingPublications: 1,
      publishingSuccessRate: 88,
      reviewsRequiringApproval: 2,
      publishingHref: "/publishing?tab=failed",
      reviewHref: "/review",
    }} />);

    expect(screen.getByText("Publishing").closest("article")).toHaveTextContent(/3 failed, 4 queued and 1 processing/i);
    expect(screen.getByText("Publishing").closest("article")).toHaveTextContent(/Overall publishing success: 88%/i);
    expect(screen.getByText("Publishing").closest("article")).toHaveTextContent("Based on all resolved publishing jobs.");
    expect(screen.getByText("Reviews").closest("article")).toHaveTextContent(/2 reviews are awaiting action in the current workflow/i);
    expect(screen.getByRole("link", { name: /Open Publishing/ })).toHaveAttribute("href", "/publishing?tab=failed");
    expect(screen.getByRole("link", { name: /Open Reviews/ })).toHaveAttribute("href", "/review");
  });

  it("uses concise review language for a real empty queue", () => {
    render(<OperationalIntelligencePanel intelligence={{
      failedPublications: 0,
      queuedPublications: 0,
      processingPublications: 0,
      publishingSuccessRate: null,
      reviewsRequiringApproval: 0,
      publishingHref: "/publishing",
      reviewHref: "/review",
    }} />);

    expect(screen.getByText("Reviews").closest("article")).toHaveTextContent("No reviews currently require action.");
    expect(screen.queryByText(/real empty queue/i)).not.toBeInTheDocument();
  });
});
