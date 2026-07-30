import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AwoInsight } from "@/core/domain/entities/dashboard";

export function AwoInsightsPanel({ insights }: { insights: AwoInsight[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Awo insights</CardTitle>
        <CardDescription>
          Deterministic observations from the same readiness rules the Generation Readiness panel uses — nothing here
          is AI-generated.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Every account is fully ready. Nothing needs attention.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {insights.map((insight, index) => (
              <li key={index} className="flex items-start gap-2.5">
                <Badge tone={insight.severity === "attention" ? "warning" : "muted"} className="mt-0.5 shrink-0">
                  {insight.organisationName}
                </Badge>
                <p className="text-[13px] text-muted-foreground">{insight.message}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
