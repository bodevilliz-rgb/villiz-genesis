"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ContentDraft, ContentDraftVersion } from "@/core/domain/entities/content";
import { formatRelative } from "@/lib/format";

interface CompareClientProps {
  draft: ContentDraft;
  versions: ContentDraftVersion[];
  v1: ContentDraftVersion;
  v2: ContentDraftVersion;
}

export function CompareWorkspaceClient({
  draft,
  versions,
  v1,
  v2,
}: CompareClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleVersionChange = (key: "v1" | "v2", val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, val);
    router.push(`${pathname}?${params.toString()}`);
  };

  const swapVersions = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v1", String(v2.version));
    params.set("v2", String(v1.version));
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* Header Bar */}
      <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-subtle-foreground mb-1">
            <Link
              href={`/review/${draft.id}`}
              className="flex items-center gap-1 hover:text-foreground text-[13px] transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Review Workspace
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Version Comparison</h1>
          <p className="mt-1 text-[12px] text-subtle-foreground truncate">
            Comparing edits for draft: <span className="font-medium text-foreground">{draft.title}</span>
          </p>
        </div>

        {/* Version selectors controls */}
        <div className="flex flex-wrap items-center gap-3 bg-card border border-border p-2.5 rounded-lg">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-subtle-foreground">V1:</span>
            <select
              value={v1.version}
              onChange={(e) => handleVersionChange("v1", e.target.value)}
              className="text-xs px-2 py-1.5 border border-border rounded bg-card select-none"
            >
              {versions.map((ver) => (
                <option key={ver.id} value={ver.version}>
                  Version {ver.version} ({ver.changedBy?.fullName || ver.changedBy?.email || "Unknown"})
                </option>
              ))}
            </select>
          </div>

          <Button variant="ghost" size="sm" onClick={swapVersions} className="h-8 w-8 p-0" title="Swap comparison sides">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-subtle-foreground">V2:</span>
            <select
              value={v2.version}
              onChange={(e) => handleVersionChange("v2", e.target.value)}
              className="text-xs px-2 py-1.5 border border-border rounded bg-card select-none"
            >
              {versions.map((ver) => (
                <option key={ver.id} value={ver.version}>
                  Version {ver.version} ({ver.changedBy?.fullName || ver.changedBy?.email || "Unknown"})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Side-by-side Comparison Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* V1 Column */}
        <Card className="border border-border/80 shadow-sm">
          <CardHeader className="bg-muted/30 py-3.5 px-4 border-b border-border flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">Version {v1.version}</span>
              <Badge tone="muted" className="text-[10px] uppercase">
                {v1.status}
              </Badge>
            </div>
            <div className="text-[11px] text-subtle-foreground">
              Saved {formatRelative(v1.createdAt)} by {v1.changedBy?.fullName || v1.changedBy?.email}
            </div>
            {v1.changeSummary && (
              <div className="text-[11px] font-medium bg-card/60 border border-border/40 p-2 rounded text-foreground">
                💬 {v1.changeSummary}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-5 flex flex-col gap-4">
            <div>
              <span className="block text-[10px] font-semibold text-subtle-foreground uppercase mb-1">
                Title
              </span>
              <h2 className="text-sm font-semibold border-b border-border/40 pb-2">{v1.title}</h2>
            </div>
            <div>
              <span className="block text-[10px] font-semibold text-subtle-foreground uppercase mb-2">
                Body
              </span>
              <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed whitespace-pre-wrap font-sans bg-card border border-border/60 rounded-lg p-4 min-h-[300px]">
                {v1.body}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* V2 Column */}
        <Card className="border border-primary/40 shadow-sm">
          <CardHeader className="bg-primary/5 py-3.5 px-4 border-b border-border flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary">Version {v2.version} (Newer)</span>
              <Badge tone="muted" className="text-[10px] uppercase">
                {v2.status}
              </Badge>
            </div>
            <div className="text-[11px] text-subtle-foreground">
              Saved {formatRelative(v2.createdAt)} by {v2.changedBy?.fullName || v2.changedBy?.email}
            </div>
            {v2.changeSummary && (
              <div className="text-[11px] font-medium bg-card/60 border border-border/40 p-2 rounded text-foreground">
                💬 {v2.changeSummary}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-5 flex flex-col gap-4">
            <div>
              <span className="block text-[10px] font-semibold text-subtle-foreground uppercase mb-1">
                Title
              </span>
              <h2 className="text-sm font-semibold border-b border-border/40 pb-2">{v2.title}</h2>
            </div>
            <div>
              <span className="block text-[10px] font-semibold text-subtle-foreground uppercase mb-2">
                Body
              </span>
              <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed whitespace-pre-wrap font-sans bg-card border border-border/60 rounded-lg p-4 min-h-[300px]">
                {v2.body}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
