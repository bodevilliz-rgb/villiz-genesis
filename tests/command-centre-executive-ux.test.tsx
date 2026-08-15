import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildExecutiveAttention, ExecutiveAttention } from "@/components/dashboard/executive-attention";
import { routes } from "@/lib/routes";

describe("Command Centre executive attention", () => {
  it("surfaces real failures before real review work and uses legitimate destinations", () => {
    const items = buildExecutiveAttention({
      failedPublications: 7,
      reviewsRequiringApproval: 4,
      publishingHref: "/organisations/org-1/publishing?tab=failed",
      reviewHref: routes.review,
    });
    const html = renderToStaticMarkup(<ExecutiveAttention items={items} />);

    expect(items.map((item) => item.kind)).toEqual(["failure", "review"]);
    expect(html).toContain("7 failed publications");
    expect(html).toContain("4 reviews require approval");
    expect(html).toContain('href="/organisations/org-1/publishing?tab=failed"');
    expect(html).toContain(`href="${routes.review}"`);
  });

  it("uses the existing MemBrain destination for a real knowledge-readiness signal", () => {
    const membrainHref = routes.organisations.membrain.index("org-1");
    const items = buildExecutiveAttention({
      failedPublications: 0,
      reviewsRequiringApproval: 0,
      publishingHref: routes.publishing,
      reviewHref: routes.review,
      readiness: {
        title: "Insight for Acme",
        detail: "MemBrain knowledge coverage is 0%.",
        href: membrainHref,
        actionLabel: "Open MemBrain",
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "readiness", href: membrainHref });
  });

  it("creates no fake warning when all tracked attention signals are absent", () => {
    const items = buildExecutiveAttention({
      failedPublications: 0,
      reviewsRequiringApproval: 0,
      publishingHref: routes.publishing,
      reviewHref: routes.review,
    });
    const html = renderToStaticMarkup(<ExecutiveAttention items={items} />);

    expect(items).toEqual([]);
    expect(html).toContain("No current action items");
    expect(html).not.toContain("failed publication");
    expect(html).not.toContain("requires approval");
  });
});
