"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { FileText, Image as ImageIcon, Video, Music, Archive, Search } from "lucide-react";
import type { MediaAsset } from "@/core/domain/entities/media";
import { routes } from "@/lib/routes";

interface MediaGridProps {
  organisationId: string;
  assets: MediaAsset[];
  signedUrls: Record<string, string>;
}

export function MediaGrid({ organisationId, assets, signedUrls }: MediaGridProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchesSearch = asset.fileName.toLowerCase().includes(search.toLowerCase()) || 
        (asset.title && asset.title.toLowerCase().includes(search.toLowerCase())) ||
        asset.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()));

      const matchesArchived = asset.isArchived === showArchived;

      let matchesCategory = true;
      if (category !== "all") {
        if (category === "image") matchesCategory = asset.mimeType.startsWith("image/");
        else if (category === "video") matchesCategory = asset.mimeType.startsWith("video/");
        else if (category === "audio") matchesCategory = asset.mimeType.startsWith("audio/");
        else if (category === "document") matchesCategory = asset.mimeType.includes("pdf") || asset.mimeType.includes("document");
      }

      return matchesSearch && matchesArchived && matchesCategory;
    });
  }, [assets, search, category, showArchived]);

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return <ImageIcon className="size-4" />;
    if (mimeType.startsWith("video/")) return <Video className="size-4" />;
    if (mimeType.startsWith("audio/")) return <Music className="size-4" />;
    return <FileText className="size-4" />;
  };

  const getFormattedSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Filters Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-input pl-9 pr-4 py-1.5 text-[13px] placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {["all", "image", "video", "audio", "document"].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`rounded-md px-3 py-1 text-[12px] font-medium capitalize border transition-colors ${
                category === cat
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              {cat}s
            </button>
          ))}

          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium border transition-colors ${
              showArchived
                ? "border-amber-500 bg-amber-500/10 text-amber-500"
                : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <Archive className="size-3.5" />
            {showArchived ? "Showing Archived" : "Show Archived"}
          </button>
        </div>
      </div>

      {/* Grid */}
      {filteredAssets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center">
          <div className="rounded-full bg-muted p-3">
            {getFileIcon(category === "all" ? "application/octet-stream" : `${category}/`)}
          </div>
          <h4 className="mt-3 text-[14px] font-medium text-foreground">No media assets found</h4>
          <p className="mt-1 text-[12px] text-muted-foreground max-w-xs">
            {isFiltered() 
              ? "No assets match your search query or category filter." 
              : "Upload documents, imagery, branding components, or video mockups to get started."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filteredAssets.map((asset) => {
            const signedUrl = signedUrls[asset.storagePath];
            const isImg = asset.mimeType.startsWith("image/");
            
            return (
              <div
                key={asset.id}
                className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-muted-foreground/30 hover:shadow-md"
              >
                {/* Media Preview Box */}
                <div className="relative aspect-video w-full overflow-hidden border-b border-border bg-muted/30 flex items-center justify-center">
                  {isImg && signedUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={signedUrl}
                      alt={asset.altText || asset.title || asset.fileName || "Media asset preview"}
                      className="size-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex flex-col items-center text-muted-foreground">
                      {getFileIcon(asset.mimeType)}
                      <span className="mt-1 text-[10px] uppercase font-mono tracking-wider">{asset.mimeType.split("/")[1]}</span>
                    </div>
                  )}

                  {asset.isAiGenerated && (
                    <span className="absolute left-2 top-2 rounded bg-primary/95 text-[10px] font-medium text-white px-1.5 py-0.5 shadow-sm">
                      AI Generated
                    </span>
                  )}
                </div>

                {/* Details Footer */}
                <div className="flex flex-col p-3.5 gap-1.5 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={routes.organisations.media.detail(organisationId, asset.id)}
                      className="text-[13px] font-medium text-foreground hover:text-primary transition-colors truncate hover:underline"
                    >
                      {asset.title || asset.fileName}
                    </Link>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-auto">
                    <span className="flex items-center gap-1">
                      {getFileIcon(asset.mimeType)}
                      {getFormattedSize(asset.sizeBytes)}
                    </span>
                    <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                  </div>

                  {asset.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {asset.tags.slice(0, 2).map((t) => (
                        <span key={t} className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono text-muted-foreground">
                          #{t}
                        </span>
                      ))}
                      {asset.tags.length > 2 && (
                        <span className="text-[9px] text-muted-foreground">+{asset.tags.length - 2}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  function isFiltered() {
    return search.length > 0 || category !== "all" || showArchived;
  }
}
