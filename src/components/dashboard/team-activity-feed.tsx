import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DashboardActivityItem } from "@/core/domain/entities/dashboard";
import { formatRelative } from "@/lib/format";

const KIND_LABEL: Record<DashboardActivityItem["kind"], string> = {
  membrain: "MemBrain",
  content: "Content",
  campaign: "Campaign",
};

export function TeamActivityFeed({ activity }: { activity: DashboardActivityItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team activity</CardTitle>
        <CardDescription>Recent work across every account, most recent first.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {activity.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted-foreground">No recent activity yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-start gap-3 px-5 py-3">
                <Badge tone="muted" className="mt-0.5 shrink-0">
                  {KIND_LABEL[item.kind]}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">
                    <span className="font-medium">
                      {item.actor?.fullName ?? item.actor?.email ?? "Someone"}
                    </span>{" "}
                    {item.action} &quot;{item.entityTitle}&quot;
                  </p>
                  <p className="text-[11px] text-subtle-foreground">
                    {item.organisationName} · {formatRelative(item.occurredAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
