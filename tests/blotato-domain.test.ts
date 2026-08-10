import { describe, expect, it } from "vitest";
import {
  mapBlotatoPlatform,
  supportedBlotatoAccounts,
  supportedPlatformsFromAccounts,
  toBlotatoPlatform,
  type BlotatoAccountSummary,
} from "@/core/domain/entities/blotato";

function account(overrides: Partial<BlotatoAccountSummary> = {}): BlotatoAccountSummary {
  return { id: "acc-1", platform: "linkedin", fullname: "Villiz Pixels", username: "villizpixels", ...overrides };
}

describe("mapBlotatoPlatform / toBlotatoPlatform", () => {
  it("maps Blotato's 'twitter' onto this app's 'x' — the one platform name that genuinely differs", () => {
    expect(mapBlotatoPlatform("twitter")).toBe("x");
    expect(toBlotatoPlatform("x")).toBe("twitter");
  });

  it("maps the 4 identically-named platforms straight through in both directions", () => {
    for (const platform of ["linkedin", "facebook", "instagram", "tiktok"] as const) {
      expect(mapBlotatoPlatform(platform)).toBe(platform);
      expect(toBlotatoPlatform(platform)).toBe(platform);
    }
  });

  it("returns null for a Blotato platform this app does not yet publish through", () => {
    expect(mapBlotatoPlatform("pinterest")).toBeNull();
    expect(mapBlotatoPlatform("threads")).toBeNull();
    expect(mapBlotatoPlatform("bluesky")).toBeNull();
    expect(mapBlotatoPlatform("youtube")).toBeNull();
    expect(mapBlotatoPlatform("webhook")).toBeNull();
    expect(mapBlotatoPlatform("other")).toBeNull();
  });
});

describe("supportedBlotatoAccounts", () => {
  it("keeps only accounts whose platform maps onto this app's own PublishingPlatform union", () => {
    const accounts = [
      account({ id: "a", platform: "linkedin" }),
      account({ id: "b", platform: "pinterest" }),
      account({ id: "c", platform: "twitter" }),
      account({ id: "d", platform: "tiktok" }),
    ];
    const supported = supportedBlotatoAccounts(accounts);
    expect(supported.map((a) => a.id)).toEqual(["a", "c", "d"]);
  });
});

describe("supportedPlatformsFromAccounts", () => {
  it("returns the distinct set of this app's own platforms that have at least one connected account, in canonical order", () => {
    const accounts = [
      account({ id: "a", platform: "twitter" }),
      account({ id: "b", platform: "linkedin" }),
      account({ id: "c", platform: "linkedin" }), // duplicate platform — must not appear twice
      account({ id: "d", platform: "pinterest" }), // unsupported — must be excluded entirely
      account({ id: "e", platform: "tiktok" }),
    ];
    expect(supportedPlatformsFromAccounts(accounts)).toEqual(["linkedin", "x", "tiktok"]);
  });

  it("returns an empty array when no connected account maps onto a supported platform", () => {
    expect(supportedPlatformsFromAccounts([account({ platform: "pinterest" })])).toEqual([]);
  });

  it("returns an empty array for no accounts at all", () => {
    expect(supportedPlatformsFromAccounts([])).toEqual([]);
  });
});
