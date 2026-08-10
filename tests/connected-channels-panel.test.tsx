// @vitest-environment jsdom
/**
 * ConnectedChannelsPanel — account identity display tests.
 *
 * Verifies that the channel selector and assigned-channel rows show
 * human-recognisable social identities (@username when available) rather
 * than opaque platform names alone.  No production code outside
 * src/components/settings/connected-channels-panel.tsx is changed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";

// ── Mock external dependencies ────────────────────────────────────────────────

vi.mock("@/server/actions/organisation-social-accounts", () => ({
  assignChannelAction: vi.fn(),
  refreshAvailableChannelsAction: vi.fn(async (previous) => previous),
  removeChannelAction: vi.fn(),
}));

vi.mock("@/server/action-result", () => ({
  idleState: { status: "idle", message: "", fieldErrors: {} },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Component under test ───────────────────────────────────────────────────────

import { ConnectedChannelsPanel } from "@/components/settings/connected-channels-panel";
import { refreshAvailableChannelsAction } from "@/server/actions/organisation-social-accounts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(refreshAvailableChannelsAction).mockImplementation(async (previous) => previous);
});

function account(overrides: Partial<BlotatoAccount> = {}): BlotatoAccount {
  return {
    id: "blotato-acc-1",
    platform: "instagram",
    username: "testuser",
    fullname: "Test User",
    organisationId: null,
    active: true,
    providerActive: true,
    firstConnectedAt: "2026-08-01T00:00:00Z",
    lastVerifiedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function renderPanel({
  channels = [] as BlotatoAccount[],
  available = [] as BlotatoAccount[],
  canManage = true,
  maxChannels = 5,
} = {}) {
  return render(
    <ConnectedChannelsPanel
      organisationId={ORG_ID}
      channels={channels}
      available={available}
      canManage={canManage}
      maxChannels={maxChannels}
    />,
  );
}

function openConnectDialog() {
  fireEvent.click(screen.getByRole("button", { name: /\+ connect channel/i }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ConnectedChannelsPanel — account selector (AssignForm)", () => {
  it("refreshes Blotato automatically when the channel dialog opens", async () => {
    renderPanel({ available: [] });
    openConnectDialog();

    await waitFor(() => expect(refreshAvailableChannelsAction).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(refreshAvailableChannelsAction).mock.calls[0]![1] as FormData;
    expect(formData.get("organisationId")).toBe(ORG_ID);
  });

  it("shows an account discovered by the automatic provider refresh without leaving the modal", async () => {
    const newlyConnected = account({ id: "new-tiktok", platform: "tiktok", username: "mervicsignatures" });
    vi.mocked(refreshAvailableChannelsAction).mockResolvedValueOnce({
      status: "success",
      message: "Found 1 available account.",
      accounts: [newlyConnected],
    });

    renderPanel({ available: [] });
    openConnectDialog();

    expect(await screen.findByText("@mervicsignatures")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "TikTok @mervicsignatures" })).toBeInTheDocument();
    expect(screen.queryByText(/run test connection/i)).toBeNull();
  });

  it("keeps provider refresh failures inside the modal with a retry action", async () => {
    vi.mocked(refreshAvailableChannelsAction)
      .mockResolvedValueOnce({ status: "error", message: "Could not refresh Blotato accounts.", accounts: [] })
      .mockResolvedValueOnce({ status: "success", message: "Found 1 available account.", accounts: [account()] });

    renderPanel({ available: [] });
    openConnectDialog();

    expect(await screen.findByText("Could not refresh Blotato accounts.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("@testuser")).toBeInTheDocument();
    expect(refreshAvailableChannelsAction).toHaveBeenCalledTimes(2);
  });

  it("explains a successful empty refresh and allows another in-place refresh", async () => {
    vi.mocked(refreshAvailableChannelsAction).mockResolvedValue({
      status: "success",
      message: "Blotato is connected, but every current account is already assigned or unavailable.",
      accounts: [],
    });

    renderPanel({ available: [] });
    openConnectDialog();

    expect(await screen.findByText(/every current account is already assigned or unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh accounts" }));
    await waitFor(() => expect(refreshAvailableChannelsAction).toHaveBeenCalledTimes(2));
  });

  it("renders @jummyte4u for an Instagram account with that username", () => {
    renderPanel({
      available: [account({ id: "acc-jm", platform: "instagram", username: "jummyte4u", fullname: "Jummy" })],
    });
    openConnectDialog();
    expect(screen.getByText("@jummyte4u")).toBeInTheDocument();
  });

  it("renders @villizpixelsuk for an Instagram account with that username", () => {
    renderPanel({
      available: [account({ id: "acc-vp", platform: "instagram", username: "villizpixelsuk", fullname: "Villiz UK" })],
    });
    openConnectDialog();
    expect(screen.getByText("@villizpixelsuk")).toBeInTheDocument();
  });

  it("makes two Instagram accounts with different usernames visually distinguishable", () => {
    renderPanel({
      available: [
        account({ id: "acc-jm", platform: "instagram", username: "jummyte4u", fullname: "Instagram" }),
        account({ id: "acc-vp", platform: "instagram", username: "villizpixelsuk", fullname: "Instagram" }),
      ],
    });
    openConnectDialog();
    expect(screen.getByText("@jummyte4u")).toBeInTheDocument();
    expect(screen.getByText("@villizpixelsuk")).toBeInTheDocument();
    // Both show "Instagram" as the primary label — the @handle is what distinguishes them
    expect(screen.getAllByText("Instagram")).toHaveLength(2);
  });

  it("gives each radio a unique accessible aria-label combining platform and handle", () => {
    renderPanel({
      available: [
        account({ id: "acc-jm", platform: "instagram", username: "jummyte4u" }),
        account({ id: "acc-vp", platform: "instagram", username: "villizpixelsuk" }),
      ],
    });
    openConnectDialog();
    expect(screen.getByRole("radio", { name: "Instagram @jummyte4u" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Instagram @villizpixelsuk" })).toBeInTheDocument();
  });

  it("submits the durable provider account ID as the form value, not the username", () => {
    const providerAccountId = "blotato-external-id-abc123";
    renderPanel({
      available: [account({ id: providerAccountId, platform: "instagram", username: "jummyte4u" })],
    });
    openConnectDialog();
    const radio = screen.getByRole("radio", { name: "Instagram @jummyte4u" }) as HTMLInputElement;
    expect(radio.value).toBe(providerAccountId);
    expect(radio.value).not.toBe("jummyte4u");
  });

  it("renders @handle for a Pinterest account (unsupported platform — label falls back to raw Blotato string)", () => {
    renderPanel({
      available: [account({ id: "acc-pin", platform: "pinterest", username: "villizpixels_uk", fullname: "Pinterest" })],
    });
    openConnectDialog();
    expect(screen.getByText("@villizpixels_uk")).toBeInTheDocument();
    // Pinterest is not in the supported platform map; platformLabel returns the raw lowercase string.
    expect(screen.getByRole("radio", { name: "pinterest @villizpixels_uk" })).toBeInTheDocument();
  });

  it("renders the 'TikTok' label for a TikTok account (Sprint 1: now a supported platform)", () => {
    renderPanel({
      available: [account({ id: "acc-tk", platform: "tiktok", username: "villizpixels_uk", fullname: "TikTok" })],
    });
    openConnectDialog();
    expect(screen.getByText("@villizpixels_uk")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "TikTok @villizpixels_uk" })).toBeInTheDocument();
  });

  it("renders @handle for a Facebook account", () => {
    renderPanel({
      available: [account({ id: "acc-fb", platform: "facebook", username: "villizpixels", fullname: "Facebook" })],
    });
    openConnectDialog();
    expect(screen.getByText("@villizpixels")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Facebook @villizpixels" })).toBeInTheDocument();
  });

  it("renders @handle for a LinkedIn account", () => {
    renderPanel({
      available: [account({ id: "acc-li", platform: "linkedin", username: "bode-okikiola", fullname: "LinkedIn" })],
    });
    openConnectDialog();
    expect(screen.getByText("@bode-okikiola")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "LinkedIn @bode-okikiola" })).toBeInTheDocument();
  });

  it("renders @handle for an X account (Blotato platform string 'twitter' maps to 'X')", () => {
    renderPanel({
      available: [account({ id: "acc-x", platform: "twitter", username: "villizpixels", fullname: "Twitter" })],
    });
    openConnectDialog();
    expect(screen.getByText("@villizpixels")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "X @villizpixels" })).toBeInTheDocument();
  });

  it("falls back to fullname when username is absent", () => {
    renderPanel({
      available: [account({ id: "acc-nousername", platform: "instagram", username: null, fullname: "Jummy T" })],
    });
    openConnectDialog();
    expect(screen.getByText("Jummy T")).toBeInTheDocument();
  });

  it("falls back to provider ID when both username and fullname are absent", () => {
    const providerId = "blotato-raw-id-xyz";
    renderPanel({
      available: [account({ id: providerId, platform: "instagram", username: null, fullname: null })],
    });
    openConnectDialog();
    expect(screen.getByText(providerId)).toBeInTheDocument();
  });

  it("does not send the operator to Publishing Settings when no cached accounts are available", async () => {
    renderPanel({ available: [] });
    openConnectDialog();
    await waitFor(() => expect(refreshAvailableChannelsAction).toHaveBeenCalled());
    expect(screen.queryByText(/run test connection/i)).toBeNull();
  });
});

describe("ConnectedChannelsPanel — assigned-channel row", () => {
  it("shows the platform label and @username for a connected channel", () => {
    renderPanel({
      channels: [account({ id: "acc-vp", platform: "instagram", username: "villizpixelsuk", organisationId: ORG_ID })],
    });
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("@villizpixelsuk")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("shows @username even when fullname is absent", () => {
    renderPanel({
      channels: [account({ id: "acc-a", platform: "instagram", username: "jummyte4u", fullname: null, organisationId: ORG_ID })],
    });
    expect(screen.getByText("@jummyte4u")).toBeInTheDocument();
  });

  it("shows fullname when username is absent", () => {
    renderPanel({
      channels: [account({ id: "acc-b", platform: "linkedin", username: null, fullname: "Bode Okikiola", organisationId: ORG_ID })],
    });
    expect(screen.getByText("Bode Okikiola")).toBeInTheDocument();
  });

  it("shows provider account ID as last resort when neither username nor fullname is set", () => {
    const providerId = "blotato-raw-id-fallback";
    renderPanel({
      channels: [account({ id: providerId, platform: "facebook", username: null, fullname: null, organisationId: ORG_ID })],
    });
    expect(screen.getByText(providerId)).toBeInTheDocument();
  });
});

describe("ConnectedChannelsPanel — channel limit and count", () => {
  it("shows the connected count and max", () => {
    renderPanel({ channels: [account({ organisationId: ORG_ID })], maxChannels: 3 });
    expect(screen.getByText("1 of 3 channels connected.")).toBeInTheDocument();
  });

  it("disables 'Connect channel' button when at the channel limit", () => {
    const atLimit = [
      account({ id: "acc-1", organisationId: ORG_ID }),
      account({ id: "acc-2", organisationId: ORG_ID }),
      account({ id: "acc-3", organisationId: ORG_ID }),
    ];
    renderPanel({ channels: atLimit, maxChannels: 3 });
    expect(screen.getByRole("button", { name: /\+ connect channel/i })).toBeDisabled();
  });

  it("shows the empty-state message when no channels are connected", () => {
    renderPanel({ channels: [], canManage: true });
    expect(screen.getByText(/no channels connected/i)).toBeInTheDocument();
    expect(screen.getByText(/click.*connect channel/i)).toBeInTheDocument();
  });

  it("shows non-admin empty-state message when canManage is false", () => {
    renderPanel({ channels: [], canManage: false });
    expect(screen.getByText(/ask a platform administrator/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /\+ connect channel/i })).toBeNull();
  });
});

describe("ConnectedChannelsPanel — assign and remove forms use correct hidden fields", () => {
  it("assign form includes the organisationId hidden input", () => {
    renderPanel({
      available: [account({ id: "acc-vp", platform: "instagram", username: "villizpixelsuk" })],
    });
    openConnectDialog();
    const orgInputs = document.querySelectorAll<HTMLInputElement>('input[name="organisationId"]');
    // At least one (the assign form's hidden field)
    expect(orgInputs.length).toBeGreaterThan(0);
    expect(orgInputs[0]!.value).toBe(ORG_ID);
  });

  it("remove form includes a blotatoAccountId hidden input matching the channel's provider ID", () => {
    const providerId = "blotato-external-id-remove-test";
    renderPanel({
      channels: [account({ id: providerId, platform: "instagram", username: "jummyte4u", organisationId: ORG_ID })],
    });
    const hiddenInput = document.querySelector<HTMLInputElement>('input[name="blotatoAccountId"]');
    expect(hiddenInput).not.toBeNull();
    expect(hiddenInput!.value).toBe(providerId);
  });
});
