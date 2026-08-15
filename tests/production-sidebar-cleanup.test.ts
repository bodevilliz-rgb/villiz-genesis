import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

describe("production sidebar configuration", () => {
  it("keeps the approved production destinations visible", async () => {
    const layout = await readFile(resolve(root, "src/app/(workspace)/layout.tsx"), "utf8");

    for (const label of ["Mission Control", "Clients", "Reviews", "Publishing", "Awo", "Settings"]) {
      expect(layout).toContain(`label: "${label}"`);
    }
    expect(layout).toContain('{ href: routes.awo, label: "Awo", icon: "sparkles" }');
  });

  it("preserves roadmap entries as configuration while hiding them from desktop and mobile production navigation", async () => {
    const layout = await readFile(resolve(root, "src/app/(workspace)/layout.tsx"), "utf8");

    for (const label of ["Inbox", "Notifications", "Projects", "Creative", "Reports", "Finance"]) {
      expect(layout).toMatch(new RegExp(`label: "${label}"[^\\n]+showInPrimaryNavigation: false`));
    }
  });

  it("preserves the workspace selector and authenticated operator identity", async () => {
    const layout = await readFile(resolve(root, "src/app/(workspace)/layout.tsx"), "utf8");

    expect(layout).toContain("<OrganisationSwitcher");
    expect(layout.match(/<UserMenu actor=\{context\.actor\}/g)).toHaveLength(2);
  });
});
