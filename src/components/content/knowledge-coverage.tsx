import Link from "next/link";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MembrainReadiness } from "@/core/application/use-cases/membrain/readiness";
import { formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Content Studio's window onto MemBrain readiness — reuses the exact
 * computation from Sprint 2 (computeMembrainReadiness) rather than adding a
 * second notion of "ready". Writers see, without leaving Content Studio,
 * whether MemBrain has what a draft would need.
 */
export function KnowledgeCoverage({
  organisationId,
  totalEntries,
  readiness,
}: {
  organisationId: string;
  totalEntries: number;
  readiness: MembrainReadiness;
}) {
  const isReady = readiness.percentage === 100;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Knowledge coverage</CardTitle>
          <CardDescription>What MemBrain can offer content written for this client.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={routes.organisations.membrain.index(organisationId)}>
            Open MemBrain
            <ArrowUpRight aria-hidden />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xl font-semibold tabular-nums tracking-tight">{readiness.percentage}%</span>
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={readiness.percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`MemBrain readiness: ${readiness.percentage}%`}
          >
            <div
              className={cn("h-full rounded-full transition-[width]", isReady ? "bg-positive" : "bg-primary")}
              style={{ width: `${readiness.percentage}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-[12px] text-subtle-foreground">
            {formatNumber(totalEntries)} {totalEntries === 1 ? "entry" : "entries"}
          </span>
        </div>

        {isReady ? (
          <p className="flex items-center gap-2 text-[12px] text-positive">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            Every fundamental is covered.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {readiness.missingAreas.map((area) => (
              <Badge key={area.categoryKey} tone="warning">
                {area.label}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
