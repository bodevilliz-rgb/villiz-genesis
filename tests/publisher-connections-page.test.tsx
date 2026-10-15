// @vitest-environment jsdom
/**
 * Render-level regression lock (PR #114 independent QA).
 *
 * The page gates the Accounts card on hub config (`{config ? <Card/> : null}`)
 * — previously the unconfigured page rendered a second, always-empty Accounts
 * card for no operator benefit. That behaviour was verified by code reading
 * only; these tests lock it at the DOM level:
 *
 *   (a) hub config null  → Accounts card hidden, only the not-configured
 *       EmptyState card remains (and its "Connect account / One tap" header is
 *       gated too, so the title matches the not-configured body);
 *   (b) hub config present + no connections → Accounts card still renders,
 *       with its empty-state body, alongside the connect header.
 *
 * The page is an async server component, so each case awaits the default
 * export directly and renders the returned tree under RTL.
 */

vi.mock("@/server/container", () => ({ requireContext: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: vi.fn(() => "genesis.example.com") })),
}));

vi.mock("@/infrastructure/publisher-hub/publisher-hub-config", () => ({
  publisherHubConfig: vi.fn(),
}));

vi.mock("@/infrastructure/publisher-hub/http-publisher-hub-client", () => ({
  resolvePublisherHubClient: vi.fn(),
}));

vi.mock("@/core/application/use-cases/publisher-connections", () => ({
  listPublisherConnections: vi.fn(),
}));

// Client child with its own server-action wiring — the render cases here only
// need the gating decision around it, so stub the table surface itself.
vi.mock("@/components/settings/connected-publisher-accounts", () => ({
  ConnectedPublisherAccounts: () => <div data-testid="publisher-accounts-table" />,
}));

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PublisherConnectionsPage from "@/app/(workspace)/settings/connections/page";
import type { HttpPublisherHubClient } from "@/infrastructure/publisher-hub/http-publisher-hub-client";
import type { PublisherHubClient } from "@/core/application/ports/publisher-hub-client-port";
import { requireContext } from "@/server/container";
import { publisherHubConfig } from "@/infrastructure/publisher-hub/publisher-hub-config";
import { resolvePublisherHubClient } from "@/infrastructure/publisher-hub/http-publisher-hub-client";
import { listPublisherConnections } from "@/core/application/use-cases/publisher-connections";

const HUB_CONFIG = { baseUrl: "https://hub.example.com", apiKey: "hub-key" };
// Port-shaped stub: the page only exercises these two methods via the use-case.
const HUB_CLIENT: PublisherHubClient = {
  listConnections: vi.fn(async () => []),
  disconnect: vi.fn(async () => undefined),
};

function aConnection() {
  return {
    account: "Jummy Ade",
    id: "sub_jummy",
    page: "urn:li:person:sub_jummy",
    connectedAt: null,
    disconnectedAt: null,
    status: "healthy" as const,
    tokenExpiresAt: null,
    scope: null,
    hasRefresh: false,
    needsReconnect: false,
    lastRefreshError: null,
    receipts: [],
  };
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const tree = await PublisherConnectionsPage({ searchParams: Promise.resolve(searchParams) });
  return render(<>{tree}</>);
}

beforeEach(() => {
  vi.mocked(requireContext).mockResolvedValue({
    actor: { isPlatformAdmin: true },
  } as never);
  vi.mocked(publisherHubConfig).mockReturnValue(HUB_CONFIG);
  // The port-typed stub satisfies the whole contract the page exercises.
  vi.mocked(resolvePublisherHubClient).mockReturnValue(
    HUB_CLIENT as unknown as HttpPublisherHubClient,
  );
  vi.mocked(listPublisherConnections).mockResolvedValue([]);
});

describe("publisher connections page rendering", () => {
  it("(a) hub unconfigured: hides the Accounts card entirely and the connect header with it", async () => {
    vi.mocked(publisherHubConfig).mockReturnValue(null);
    vi.mocked(resolvePublisherHubClient).mockReturnValue(null);

    await renderPage();

    // The only body is the not-configured EmptyState.
    expect(screen.getByRole("heading", { name: "Publishing hub not configured" })).toBeTruthy();

    // Regression lock: no second, always-empty Accounts card when unconfigured.
    expect(screen.queryByRole("heading", { name: "Accounts" })).toBeNull();
    expect(screen.queryByText("No publisher accounts connected yet")).toBeNull();

    // Regression lock (header mismatch): with no config there is nothing to
    // connect, so the "Connect account / One tap: LinkedIn asks…" header must
    // not contradict the body it wraps.
    expect(screen.queryByRole("heading", { name: "Connect account" })).toBeNull();
    expect(screen.queryByText(/One tap: LinkedIn asks/)).toBeNull();

    // Fail-closed: no hub client, so no connections fetch is attempted.
    expect(listPublisherConnections).not.toHaveBeenCalled();
  });

  it("(b) hub configured with zero connections: Accounts card renders with its empty state", async () => {
    await renderPage();

    const accountsHeading = screen.getByRole("heading", { name: "Accounts" });
    expect(accountsHeading).toBeTruthy();
    expect(screen.getByText("No publisher accounts connected yet")).toBeTruthy();
    // The connect header is back because connecting is actually possible.
    expect(screen.getByRole("heading", { name: "Connect account" })).toBeTruthy();
    expect(screen.getByText(/One tap: LinkedIn asks/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Publishing hub not configured" })).toBeNull();

    expect(vi.mocked(listPublisherConnections)).toHaveBeenCalledWith({ client: HUB_CLIENT });
  });

  it("(b2) hub configured with connections: table renders instead of the empty state", async () => {
    vi.mocked(listPublisherConnections).mockResolvedValue([aConnection()]);

    await renderPage();

    expect(screen.getByTestId("publisher-accounts-table")).toBeTruthy();
    expect(screen.queryByText("No publisher accounts connected yet")).toBeNull();
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeTruthy();
  });
});