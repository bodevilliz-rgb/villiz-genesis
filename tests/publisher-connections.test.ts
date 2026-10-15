import { describe, expect, it } from "vitest";
import {
  buildPublisherConnectHref,
  formatTokenExpiry,
  mapPublisherConnections,
  normalisePublisherConnectionStatus,
  PUBLISHER_CONNECTION_STATUS_LABELS,
  PUBLISHER_CONNECTION_STATUS_TONES,
} from "@/core/domain/entities/publisher-connections";

const NOW = new Date("2026-10-15T12:00:00Z");

describe("normalisePublisherConnectionStatus", () => {
  it("passes known bands through", () => {
    expect(normalisePublisherConnectionStatus("healthy")).toBe("healthy");
    expect(normalisePublisherConnectionStatus("disconnected")).toBe("disconnected");
  });

  it("fails closed to needs-reconnect on unknown bands", () => {
    expect(normalisePublisherConnectionStatus("mystery")).toBe("needs-reconnect");
    expect(normalisePublisherConnectionStatus(undefined)).toBe("needs-reconnect");
  });
});

describe("status presentation maps", () => {
  it("maps bands to the designed badge tones", () => {
    expect(PUBLISHER_CONNECTION_STATUS_TONES.healthy).toBe("positive");
    expect(PUBLISHER_CONNECTION_STATUS_TONES.expiring).toBe("warning");
    expect(PUBLISHER_CONNECTION_STATUS_TONES.expired).toBe("danger");
    expect(PUBLISHER_CONNECTION_STATUS_TONES["needs-reconnect"]).toBe("warning");
    expect(PUBLISHER_CONNECTION_STATUS_TONES.disconnected).toBe("muted");
  });

  it("labels every band", () => {
    expect(PUBLISHER_CONNECTION_STATUS_LABELS.healthy).toBe("Healthy");
    expect(PUBLISHER_CONNECTION_STATUS_LABELS["needs-reconnect"]).toBe("Reconnect needed");
    expect(PUBLISHER_CONNECTION_STATUS_LABELS.disconnected).toBe("Disconnected");
  });
});

describe("formatTokenExpiry", () => {
  it("summarises long runways in days+hours", () => {
    // 36h02m remaining.
    expect(formatTokenExpiry("2026-10-17T00:02:00Z", NOW)).toBe("1d 12h");
    // Exactly 30 days remaining.
    expect(formatTokenExpiry("2026-11-14T12:00:00Z", NOW)).toBe("30d");
  });

  it("goes hour/minute-granular when urgent", () => {
    expect(formatTokenExpiry("2026-10-15T20:30:00Z", NOW)).toBe("8h 30m");
    expect(formatTokenExpiry("2026-10-15T12:59:00Z", NOW)).toBe("59m");
  });

  it("reports expired and absent", () => {
    expect(formatTokenExpiry("2026-10-01T00:00:00Z", NOW)).toBe("expired");
    expect(formatTokenExpiry(null, NOW)).toBeNull();
    expect(formatTokenExpiry("not-a-date", NOW)).toBeNull();
  });
});

describe("mapPublisherConnections", () => {
  it("maps the hub accounts surface into domain rows", () => {
    const rows = mapPublisherConnections([
      {
        account: "Jummy Ade",
        id: "sub_jummy",
        page: "urn:li:person:sub_jummy",
        connectedAt: "2026-10-15T10:00:00Z",
        status: "healthy",
        tokenExpiresAt: "2026-12-14T10:00:00Z",
        scope: "openid profile w_member_social",
        hasRefresh: false,
        needsReconnect: false,
        lastRefreshError: null,
        receipts: [
          {
            postSubmissionId: "p1",
            status: "done",
            publicUrl: "https://example.com/post",
            createdAt: "2026-10-15T10:30:00Z",
          },
        ],
      },
      { id: "", status: "healthy" }, // dropped: meaningless without an id
      { id: "ghost", status: "mystery" }, // unknown band normalises fail-closed
    ]);

    expect(rows).toHaveLength(2);
    const [jummy, ghost] = rows;
    expect(jummy).toBeDefined();
    expect(jummy).toMatchObject({
      id: "sub_jummy",
      account: "Jummy Ade",
      page: "urn:li:person:sub_jummy",
      status: "healthy",
      hasRefresh: false,
      receipts: [{ postSubmissionId: "p1", status: "done", publicUrl: "https://example.com/post" }],
    });
    expect(ghost?.status).toBe("needs-reconnect");
  });

  it("defaults receipts to an empty list and nulls unknown strings", () => {
    const rows = mapPublisherConnections([{ id: "a", status: "healthy" }]);
    const [first] = rows;
    expect(first?.receipts).toEqual([]);
    expect(first?.tokenExpiresAt).toBeNull();
    expect(first?.lastRefreshError).toBeNull();
  });
});

describe("buildPublisherConnectHref", () => {
  it("points at the hub start route with the source URL encoded", () => {
    expect(
      buildPublisherConnectHref(
        "https://hub.example.com/",
        "https://genesis.example.com/settings/connections",
      ),
    ).toBe(
      "https://hub.example.com/v2/oauth/linkedin/start?source=https%3A%2F%2Fgenesis.example.com%2Fsettings%2Fconnections",
    );
  });

  it("keeps the plain start route when no source is available", () => {
    expect(buildPublisherConnectHref("https://hub.example.com", null)).toBe(
      "https://hub.example.com/v2/oauth/linkedin/start",
    );
  });
});