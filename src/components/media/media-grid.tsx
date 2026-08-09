"use client";
import { useState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { FileText, Image as ImageIcon, Video, Music, Archive, Search, Loader2 } from "lucide-react";
import type { MediaAssetListItem } from "@/core/domain/entities/media";
import { routes } from "@/lib/routes";
import { fetchMediaLibraryPageAction } from "@/server/actions/media";

/**
 * Conservative initial page size for the Media Library grid — chosen to
 * comfortably clear a single bounded server response (a handful of assets'
 * worth of lightweight metadata + signed URLs) while filling several rows
 * of the existing 2/3/4-column grid without pagination controls dominating
 * the page. 24 divides evenly into every breakpoint's column count (2, 3, 4).
 */
export const MEDIA_LIBRARY_PAGE_SIZE = 24;

type MimeFilter = "all" | "image" | "video" | "audio" | "document";

interface MediaGridProps {
  organisationId: string;
  initialItems: MediaAssetListItem[];
  initialSignedUrls: Record<string, string>;
  initialHasMore: boolean;
  initialTotal: number;
}

export function MediaGrid({ organisationId, initialItems, initialSignedUrls, initialHasMore, initialTotal }: MediaGridProps) {
  const [items, setItems] = useState(initialItems);
  const [signedUrls, setSignedUrls] = useState(initialSignedUrls);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [total, setTotal] = useState(initialTotal);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<MimeFilter>("all");
  const [showArchived, setShowArchived] = useState(false);

  const [isPending, startTransition] = useTransition();
  const isFirstRender = useRef(true);

  // The server re-provides fresh page-1 data on every revalidation (upload,
  // archive, delete, etc. all call revalidatePath on this route) — resync
  // local state to that instead of freezing at first mount, so a new upload
  // becomes visible without ever re-fetching the whole library.
  useEffect(() => {
    setItems(initialItems);
    setSignedUrls(initialSignedUrls);
    setHasMore(initialHasMore);
    setTotal(initialTotal);
  }, [initialItems, initialSignedUrls, initialHasMore, initialTotal]);

  // Debounced server-side search/filter — re-queries from the start of the
  // library on every change instead of filtering only what's already loaded,
  // so search and the mime-type/archived filters work across the entire
  // library, not just the current page.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await fetchMediaLibraryPageAction(organisationId, {
          limit: MEDIA_LIBRARY_PAGE_SIZE,
          offset: 0,
          search: search.trim() || undefined,
          mimeFilter: category === "all" ? undefined : category,
          isArchived: showArchived,
        });
        setItems(result.items);
        setSignedUrls(result.signedUrls);
        setHasMore(result.hasMore);
        setTotal(result.total);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [search, category, showArchived, organisationId]);

  const loadMore = () => {
    startTransition(async () => {
      const result = await fetchMediaLibraryPageAction(organisationId, {
        limit: MEDIA_LIBRARY_PAGE_SIZE,
        offset: items.length,
        search: search.trim() || undefined,
        mimeFilter: category === "all" ? undefined : category,
        isArchived: showArchived,
      });
      const seen = new Set(items.map((a) => a.id));
      const deduped = result.items.filter((a) => !seen.has(a.id));
      setItems((prev) => [...prev, ...deduped]);
      setSignedUrls((prev) => ({ ...prev, ...result.signedUrls }));
      setHasMore(result.hasMore);
      setTotal(result.total);
    });
  };

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

  const isFiltered = search.length > 0 || category !== "all" || showArchived;

  return (
    <div className="flex flex-col gap-6">
      {/* Filters Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-input pl-9 pr-4 py-1.5 text-[13px] placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["all", "image", "video", "audio", "document"] as const).map((cat) => (
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
      {items.length === 0 && !isPending ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center">
          <div className="rounded-full bg-muted p-3">
            {getFileIcon(category === "all" ? "application/octet-stream" : `${category}/`)}
          </div>
          <h4 className="mt-3 text-[14px] font-medium text-foreground">No media assets found</h4>
          <p className="mt-1 text-[12px] text-muted-foreground max-w-xs">
            {isFiltered
              ? "No assets match your search query or category filter."
              : "Upload documents, imagery, branding components, or video mockups to get started."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {items.map((asset) => {
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

          <div className="flex flex-col items-center gap-2 pt-2">
            <p className="text-[11px] text-muted-foreground">
              Showing {formatCount(items.length)} of {formatCount(total)}
            </p>
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/40 disabled:opacity-60"
              >
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {isPending ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function formatCount(n: number): string {
  return n.toLocaleString();
}
