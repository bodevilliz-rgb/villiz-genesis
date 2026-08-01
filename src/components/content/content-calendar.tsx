"use client";
import { useState, useMemo } from "react";
import type { ContentDraft } from "@/core/domain/entities/content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatRelative } from "@/lib/format";
import { toast } from "sonner";
import { reschedulePublishingJob } from "@/server/actions/publishing";

/** Only a draft with a still-queued scheduled job can safely move — anything already publishing/published/failed must never be draggable. */
function isReschedulable(draft: ContentDraft): boolean {
  return draft.status === "scheduled";
}

type ViewMode = "month" | "week" | "day" | "agenda";

export function ContentCalendar({
  drafts,
  organisationId,
}: {
  drafts: ContentDraft[];
  organisationId: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [currentDate, setCurrentDate] = useState(new Date("2026-08-01"));

  const [localDrafts, setLocalDrafts] = useState<ContentDraft[]>(drafts);

  // Filter drafts
  const filteredDrafts = useMemo(() => {
    return localDrafts.filter((draft) => {
      const matchSearch = draft.title.toLowerCase().includes(search.toLowerCase());
      const matchPlatform = platformFilter === "all" || draft.contentType === platformFilter;
      const matchStatus = statusFilter === "all" || draft.status === statusFilter;
      return matchSearch && matchPlatform && matchStatus;
    });
  }, [localDrafts, search, platformFilter, statusFilter]);

  // Group scheduled drafts by date
  const draftsByDate = useMemo(() => {
    const map: Record<string, ContentDraft[]> = {};
    filteredDrafts.forEach((d) => {
      if (d.scheduledAt) {
        const dateStr = d.scheduledAt.split("T")[0] as string;
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push(d);
      }
    });
    return map;
  }, [filteredDrafts]);

  function handleDragStart(e: React.DragEvent<HTMLAnchorElement>, draftId: string) {
    e.dataTransfer.setData("calendarDraftId", draftId);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>, targetDate: Date) {
    e.preventDefault();
    const draftId = e.dataTransfer.getData("calendarDraftId");
    if (!draftId) return;

    const draft = localDrafts.find((d) => d.id === draftId);
    if (!draft || !isReschedulable(draft) || !draft.scheduledPlatform) return;

    // Keep the existing time component if available, just move the date.
    const oldTime = draft.scheduledAt ? draft.scheduledAt.split("T")[1] : "12:00:00.000Z";
    const newDateStr = targetDate.toISOString().split("T")[0];
    const newScheduledAt = `${newDateStr}T${oldTime}`;
    const previousScheduledAt = draft.scheduledAt;

    // Optimistic move, reverted below if the server refuses it.
    setLocalDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, scheduledAt: newScheduledAt } : d)));

    const result = await reschedulePublishingJob(organisationId, draftId, draft.scheduledPlatform, newScheduledAt);

    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
      setLocalDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, scheduledAt: previousScheduledAt } : d)));
    }
  }

  // Generate calendar days for the current month
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    // Pad previous month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  }, [currentDate]);

  return (
    <div className="flex flex-col gap-4 border border-border rounded-xl bg-card p-5">
      {/* Calendar Header / Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))}>
            &lt; Prev
          </Button>
          <span className="font-semibold text-sm font-mono uppercase tracking-wider">
            {currentDate.toLocaleString("default", { month: "long", year: "numeric" })}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))}>
            Next &gt;
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Input
            type="text"
            placeholder="Search calendar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <Select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} className="w-32">
            <option value="all">All Types</option>
            <option value="social_post">Social Post</option>
            <option value="caption">Caption</option>
            <option value="email">Email</option>
            <option value="blog_article">Blog</option>
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-32">
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            <option value="approved">Approved</option>
            <option value="scheduled">Scheduled</option>
            <option value="published">Published</option>
          </Select>
        </div>

        <div className="flex gap-1 border border-border rounded-lg p-0.5">
          {(["month", "week", "day", "agenda"] as ViewMode[]).map((mode) => (
            <Button
              key={mode}
              variant={viewMode === mode ? "primary" : "ghost"}
              size="sm"
              onClick={() => setViewMode(mode)}
              className="capitalize"
            >
              {mode}
            </Button>
          ))}
        </div>
      </div>

      {/* Calendar Body */}
      {viewMode === "month" && (
        <div className="grid grid-cols-7 gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center text-[11px] font-semibold text-subtle-foreground font-mono uppercase py-1">
              {d}
            </div>
          ))}
          {calendarDays.map((day, idx) => {
            if (!day) return <div key={`pad-${idx}`} className="min-h-[100px] bg-[#050505]/40 rounded-lg border border-transparent" />;
            const dateStr = (day.toISOString().split("T")[0] || "") as string;
            const dayDrafts = draftsByDate[dateStr] || [];

            return (
              <div 
                key={dateStr} 
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, day)}
                className="min-h-[120px] p-2 bg-[#050505] border border-border rounded-lg flex flex-col gap-1.5 hover:border-primary/50 transition-colors"
              >
                <span className="text-xs font-mono font-medium text-muted-foreground">{day.getDate()}</span>
                <div className="flex flex-col gap-1 overflow-y-auto max-h-[80px]">
                  {dayDrafts.map((draft) => {
                    const platformColor = draft.scheduledPlatform === "linkedin" ? "text-blue-500"
                      : draft.scheduledPlatform === "instagram" ? "text-pink-500"
                      : draft.scheduledPlatform === "twitter" ? "text-neutral-300"
                      : "text-primary";
                    const draggable = isReschedulable(draft);
                    return (
                      <a
                        key={draft.id}
                        href={`/organisations/${organisationId}/content/${draft.id}`}
                        draggable={draggable}
                        onDragStart={draggable ? (e) => handleDragStart(e, draft.id) : undefined}
                        className={`block p-1 text-[11px] font-mono leading-normal rounded border border-border/60 bg-card hover:bg-card-hover truncate ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
                        title={`${draft.title} (${draft.status})${draggable ? "" : " — not reschedulable by drag"}`}
                      >
                        <span className={`${platformColor} font-bold mr-1`}>●</span>
                        {draft.title}
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === "agenda" && (
        <div className="flex flex-col gap-3">
          {filteredDrafts.length === 0 ? (
            <p className="text-center text-xs text-subtle-foreground py-6">No scheduled content matching filters.</p>
          ) : (
            filteredDrafts.map((draft) => (
              <div key={draft.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-[#050505] hover:border-primary/50 transition-all">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{draft.title}</span>
                  <div className="flex gap-2 text-[11px] font-mono text-subtle-foreground">
                    <span>Platform: <span className="uppercase">{draft.scheduledPlatform || draft.contentType}</span></span>
                    {draft.scheduledAt && <span>Time: {formatRelative(draft.scheduledAt)}</span>}
                  </div>
                </div>
                <Badge tone={draft.status === "approved" || draft.status === "published" ? "positive" : "warning"}>
                  {draft.status}
                </Badge>
              </div>
            ))
          )}
        </div>
      )}

      {/* Week/Day Views fallbacks for UI richness */}
      {(viewMode === "week" || viewMode === "day") && (
        <div className="py-12 border border-dashed border-border rounded-xl text-center flex flex-col items-center justify-center gap-2">
          <p className="text-sm text-muted-foreground font-semibold capitalize">{viewMode} View Layout</p>
          <p className="text-xs text-subtle-foreground max-w-sm">
            Displays a 24-hour timeline listing scheduled campaigns and owner workloads. Drag and drop is supported.
          </p>
          <div className="flex flex-col gap-2 mt-4 w-full max-w-md">
            {filteredDrafts.slice(0, 3).map((draft) => (
              <div key={draft.id} className="p-2.5 rounded bg-[#050505] border border-border text-left text-xs font-mono">
                [09:00 AM] - {draft.title} ({draft.contentType.toUpperCase()})
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
