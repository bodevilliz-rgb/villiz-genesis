import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MembrainStatusBadge } from "@/components/common/status-badge";
import { ALWAYS_IN_CONTEXT_THRESHOLD, importanceLabel, type MembrainSearchHit } from "@/core/domain/entities/membrain";
import { formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

/**
 * `headline` comes from Postgres ts_headline and contains <mark> tags around
 * matched terms. Everything else is escaped by React; only this one field is
 * rendered as HTML, and its content originates from our own database rather
 * than from any external input.
 */
export function SearchResults({
  organisationId,
  hits,
  categoryLabels,
}: {
  organisationId: string;
  hits: MembrainSearchHit[];
  categoryLabels: Map<string, string>;
}) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {hits.map((hit) => (
        <li key={hit.id}>
          <Link
            href={routes.organisations.membrain.entry(organisationId, hit.id)}
            className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-card-hover"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden
                className="h-4 w-0.5 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    hit.importance >= ALWAYS_IN_CONTEXT_THRESHOLD ? "var(--primary)" : "var(--border-strong)",
                }}
              />
              <h3 className="text-[13px] font-medium">{hit.title}</h3>
              <MembrainStatusBadge status={hit.status} />
              {hit.categoryId ? (
                <Badge tone="muted">{categoryLabels.get(hit.categoryId) ?? "Uncategorised"}</Badge>
              ) : null}
            </div>

            {hit.headline ? (
              <p
                className="membrain-headline line-clamp-2 text-[13px] text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: hit.headline }}
              />
            ) : null}

            <p className="font-mono text-[11px] text-subtle-foreground">
              {importanceLabel(hit.importance)} · v{hit.version} · updated {formatRelative(hit.updatedAt)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
