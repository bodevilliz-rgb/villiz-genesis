import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "redesign", "directions");
const boards = [
  "d1-console-dark.html",
  "d2-quiet-luxury.html",
  "d3-soft-signal.html",
];
const requiredSections = [
  "Today",
  "Needs you",
  "Fires today",
  "Picks Queue",
  "Live feed",
  "Weekly scorecard",
  "Proposed tweaks",
];
const requiredContent = [
  "Mervic ITEMS 1–10 Week",
  "Karatique DAY/MM/WGN",
  "DeY8RoJnGRg",
  "7695715047229754646",
  "7695715074299792662",
  "DeY83mgG6ZV",
];

describe("Genesis direction boards", () => {
  for (const board of boards) {
    it(`${board} is a complete standalone real-content board`, () => {
      const html = readFileSync(join(root, board), "utf8");
      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).not.toMatch(/https?:\/\/[^\s"']+\.(?:png|jpe?g|webp)/i);
      expect(html).toContain('name="viewport"');
      for (const section of requiredSections) expect(html).toContain(section);
      for (const navItem of ["Today", "Queue", "Feed", "Reports"]) {
        expect(html).toContain(`>${navItem}<`);
      }
      for (const item of requiredContent) expect(html).toContain(item);
      expect(html.match(/class="go(?:\s|\")/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
      expect(html).toContain("Metrics awaiting first sync");
    });
  }

  it("documents all directions and their tokens", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    for (const direction of ["Console Dark", "Quiet Luxury", "Soft Signal"]) {
      expect(readme).toContain(direction);
    }
    expect(readme.match(/#[0-9A-Fa-f]{6}/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
  });
});
