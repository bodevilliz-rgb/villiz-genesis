"use client";
import type { CampaignListItem } from "@/core/domain/entities/campaign";
import type { ContentDraft } from "@/core/domain/entities/content";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { computeCampaignTimelineProgress } from "@/core/domain/entities/campaign";

export function CampaignDashboard({
  campaigns,
  drafts,
  _organisationId,
}: {
  campaigns: CampaignListItem[];
  drafts: ContentDraft[];
  _organisationId: string;
}) {
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const _plannedCampaigns = campaigns.filter((c) => c.status === "planning");
  const completedCampaigns = campaigns.filter((c) => c.status === "completed");

  const awaitingReviewCount = drafts.filter((d) => d.status === "in_review" || d.status === "needs_review").length;
  const _publishedCount = drafts.filter((d) => d.status === "published").length;
  const scheduledCount = drafts.filter((d) => d.status === "scheduled").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Overview Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-primary bg-[#050505]">
          <CardContent className="pt-4 flex flex-col gap-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Active Campaigns</span>
            <span className="text-2xl font-bold">{activeCampaigns.length}</span>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-600 bg-[#050505]">
          <CardContent className="pt-4 flex flex-col gap-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Awaiting Review</span>
            <span className="text-2xl font-bold">{awaitingReviewCount}</span>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-600 bg-[#050505]">
          <CardContent className="pt-4 flex flex-col gap-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Scheduled Posts</span>
            <span className="text-2xl font-bold">{scheduledCount}</span>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-600 bg-[#050505]">
          <CardContent className="pt-4 flex flex-col gap-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Completed Campaigns</span>
            <span className="text-2xl font-bold">{completedCampaigns.length}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Campaign Health & Content Progress */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="bg-[#050505] border border-border">
            <CardHeader>
              <CardTitle>Campaign Health & Timeline Progress</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {activeCampaigns.length === 0 ? (
                <p className="text-xs text-subtle-foreground">No active campaigns running currently.</p>
              ) : (
                activeCampaigns.map((c) => {
                  const progress = computeCampaignTimelineProgress(c.startDate, c.endDate);
                  const percent = progress.percentElapsed ?? 0;
                  return (
                    <div key={c.id} className="flex flex-col gap-2 pb-3 border-b border-border/40 last:border-b-0">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold">{c.name}</span>
                        <span className="font-mono text-muted-foreground">{percent}% Elapsed</span>
                      </div>
                      <div className="w-full bg-[#111] h-2 rounded-full overflow-hidden">
                        <div className="bg-primary h-full transition-all duration-300" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="text-[10px] text-subtle-foreground font-mono">
                        {c.startDate} to {c.endDate} · {c.platforms.map((p) => p.toUpperCase()).join(", ")}
                      </span>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* AI recommendations widget */}
          <Card className="bg-[#050505] border border-border">
            <CardHeader>
              <CardTitle className="text-primary font-mono text-xs uppercase tracking-wider">Awo AI Planner Insights</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="rounded border border-primary/20 bg-primary/5 p-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold">Content Gap Detected</span>
                <p className="text-[11px] text-muted-foreground leading-normal">
                  Campaign has no scheduled posts on **LinkedIn** for the coming week. Generating a suggested content pipeline is recommended.
                </p>
              </div>
              <div className="rounded border border-yellow-600/20 bg-yellow-600/5 p-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold">Conflict Warning</span>
                <p className="text-[11px] text-muted-foreground leading-normal">
                  Multiple posts are scheduled close to each other on **Twitter/X** on Tuesday afternoon. Easing the schedule is advised.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Widgets (Awaiting Review, Recent Activity, Team Workload) */}
        <div className="flex flex-col gap-4">
          {/* Upcoming Schedule Dates */}
          <Card className="bg-[#050505] border border-border">
            <CardHeader>
              <CardTitle>Upcoming Publish Dates</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {drafts.filter((d) => d.status === "scheduled").slice(0, 3).length === 0 ? (
                <p className="text-xs text-subtle-foreground">No posts scheduled for release.</p>
              ) : (
                drafts.filter((d) => d.status === "scheduled").slice(0, 3).map((d) => (
                  <div key={d.id} className="flex justify-between items-center p-2 rounded border border-border bg-[#0a0a0a] text-xs">
                    <span className="truncate max-w-[150px]">{d.title}</span>
                    <Badge tone="accent" className="uppercase font-mono text-[9px]">{d.scheduledPlatform}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Team Workload */}
          <Card className="bg-[#050505] border border-border">
            <CardHeader>
              <CardTitle>Team Workload</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs pb-1.5 border-b border-border/40">
                <span className="font-medium text-muted-foreground">Team Member</span>
                <span className="font-mono text-muted-foreground">Assigned Drafts</span>
              </div>
              <div className="flex justify-between text-xs py-1">
                <span>Priya (Reviewer)</span>
                <span className="font-mono">{drafts.filter((d) => d.status === "in_review" || d.status === "needs_review").length}</span>
              </div>
              <div className="flex justify-between text-xs py-1">
                <span>You (Lead)</span>
                <span className="font-mono">{drafts.filter((d) => d.status === "draft").length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
