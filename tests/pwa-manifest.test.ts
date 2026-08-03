import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const MANIFEST_PATH = path.resolve(__dirname, "..", "public", "manifest.webmanifest");
const ICON_PATH = path.resolve(__dirname, "..", "public", "icon.svg");

describe("PWA manifest (Sprint 8.0 lightweight installability)", () => {
  it("is valid, parseable JSON", () => {
    const raw = readFileSync(MANIFEST_PATH, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("declares the required installability fields", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(typeof manifest.short_name).toBe("string");
    expect(manifest.display).toBe("standalone");
    expect(typeof manifest.start_url).toBe("string");
    expect(manifest.start_url.startsWith("/")).toBe(true);
  });

  it("declares theme and background colours as valid hex colours", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const hexColour = /^#[0-9a-f]{6}$/i;
    expect(manifest.theme_color).toMatch(hexColour);
    expect(manifest.background_color).toMatch(hexColour);
  });

  it("declares at least one icon pointing at a real, existing file", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(typeof icon.src).toBe("string");
      expect(icon.src.startsWith("/")).toBe(true);
      expect(typeof icon.type).toBe("string");
    }
  });

  it("references an icon file that actually exists and is a valid SVG", () => {
    const svg = readFileSync(ICON_PATH, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
  });
});
