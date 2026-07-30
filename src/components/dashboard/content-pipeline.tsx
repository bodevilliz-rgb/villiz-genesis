import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContentPipelineSummary } from "@/core/domain/entities/dashboard";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Ready to publish" and "Published" are rendered as permanently greyed-out,
 * zero-count stages — there is no Publisher/Blotato integration in Genesis
 * yet, so counting real drafts into either would misrepresent data that
 * doesn't mean that. This mirrors the same "disabled rather than hidden"
 * convention the sidebar already uses for unbuilt destinations.
 */
export function ContentPipelinePanel({ pipeline }: { pipeline: ContentPipelineSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Content pipeline</CardTitle>
        <CardDescription>
          {formatNumber(pipeline.totalDrafts)} active {pipeline.totalDrafts === 1 ? "draft" : "drafts"} across every
          account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {pipeline.stages.map((stage) => (
            <div
              key={stage.key}
              className={cn(
                "flex flex-col gap-1 rounded-md border px-3 py-2.5",
                stage.isTracked ? "border-border bg-card" : "border-dashed border-border-strong bg-transparent opacity-60",
              )}
            >
              <span className="truncate text-[11px] uppercase tracking-wider text-subtle-foreground">
                {stage.label}
              </span>
              <span className="text-lg font-semibold tabular-nums tracking-tight">
                {stage.isTracked ? formatNumber(stage.count) : "—"}
              </span>
              {!stage.isTracked ? (
                <span className="text-[10px] text-subtle-foreground">Not yet built</span>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
