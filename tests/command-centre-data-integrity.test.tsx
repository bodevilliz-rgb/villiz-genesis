import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AwoRecommendationCard,
  ClientDeliveryStatus,
  CommandCentreHeader,
  PublishingQueue,
  RevenueSummary,
  TeamWorkload,
} from "@/components/dashboard/command-centre-components";

const dashboardPageSource = readFileSync(
  new URL("../src/app/(workspace)/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const commandCentreSource = readFileSync(
  new URL("../src/components/dashboard/command-centre-components.tsx", import.meta.url),
  "utf8",
);

describe("Command Centre data integrity", () => {
  it("does not leak the known demo identities or fake financial/review values", () => {
    const productionSource = `${dashboardPageSource}\n${commandCentreSource}`;

    for (const demoValue of ["Sarah Chen", "David Rodriguez", "Marie H.", "$842,500.00", "1.8 Days", 'revisionRate="18%"']) {
      expect(productionSource).not.toContain(demoValue);
    }
  });

  it("renders honest empty states when revenue and workload sources do not exist", () => {
    const revenue = renderToStaticMarkup(<RevenueSummary />);
    const workload = renderToStaticMarkup(<TeamWorkload staff={[]} />);

    expect(revenue).toContain("Not configured in Genesis");
    expect(revenue).not.toContain("$842,500.00");
    expect(workload).toContain("Work assignment data is not configured in Genesis");
  });

  it("does not manufacture an Awo recommendation, campaign risk, queue item, or delivery progress", () => {
    expect(renderToStaticMarkup(<AwoRecommendationCard />)).toContain("No operational recommendations available");
    expect(renderToStaticMarkup(<CommandCentreHeader fullName="Real Operator" initialGreetingHour={9} totalReviews={0} atRisk={null} />))
      .toContain("Campaign risk is not currently tracked");
    expect(renderToStaticMarkup(<PublishingQueue items={[]} />)).toContain("No publications scheduled");
    expect(renderToStaticMarkup(
      <ClientDeliveryStatus projects={[{ id: "1", name: "Campaign", clientName: "Client", progress: null, status: "active" }]} />,
    )).toContain("Campaign dates unavailable");
  });

  it("renders real values passed from authoritative read models", () => {
    const workload = renderToStaticMarkup(
      <TeamWorkload staff={[{ id: "real-1", name: "Real Person", role: "Reviewer", activeCount: 2 }]} />,
    );
    const advisory = renderToStaticMarkup(
      <AwoRecommendationCard insight={{ id: "org-1", title: "Real readiness insight", detail: "Derived from readiness records", type: "attention", href: "/organisations/org-1/membrain", actionLabel: "Open MemBrain" }} />,
    );

    expect(workload).toContain("Real Person");
    expect(workload).toContain("2 Active");
    expect(advisory).toContain("Real readiness insight");
    expect(advisory).toContain("Attention");
    expect(advisory).toContain('href="/organisations/org-1/membrain"');
    expect(advisory).not.toContain("High Risk");
  });
});
