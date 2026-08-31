import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export type CampaignReviewWeek = {
  weekNumber: number;
  assetLabel: string;
  imageUrl?: string;
  optimised: boolean;
  slots: Array<{
    id: string;
    platformLabel: string;
    draftId: string | null;
    draftStatus: string | null;
    body: string;
    hashtags: string[];
  }>;
};

export function CampaignReviewGrid({ organisationId, weeks }: { organisationId: string; weeks: CampaignReviewWeek[] }) {
  return (
    <section id="campaign-review" className="rounded-xl border border-border bg-card scroll-mt-24">
      <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Campaign review workspace</h3>
          <p className="mt-1 text-xs text-muted-foreground">Open a week to inspect Awo&apos;s platform copy. Approval happens inside each post&apos;s Content Studio review panel.</p>
        </div>
        <span className="text-xs text-muted-foreground">{weeks.length} weeks · {weeks.reduce((sum, week) => sum + week.slots.length, 0)} platform posts</span>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-2">
        {weeks.map((week) => (
          <details key={week.weekNumber} className="group overflow-hidden rounded-xl border border-border bg-muted/10 open:bg-background">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <div className="grid sm:grid-cols-[180px_minmax(0,1fr)]">
                <div className="aspect-square bg-muted/30 sm:aspect-auto sm:min-h-[180px]">
                  {week.imageUrl ? <img src={week.imageUrl} alt={`Week ${week.weekNumber}`} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="flex min-w-0 flex-col justify-between gap-4 p-4">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">Week {week.weekNumber}</p>
                      <Badge tone={week.optimised ? "positive" : "muted"}>{week.optimised ? "Ready for review" : "Prepared"}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{week.assetLabel}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {week.slots.map((slot) => <Badge key={slot.id} tone={slot.draftStatus === "approved" || slot.draftStatus === "scheduled" || slot.draftStatus === "published" ? "positive" : "muted"}>{slot.platformLabel} · {formatStatus(slot.draftStatus)}</Badge>)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs font-medium text-primary">
                    <span>Open Week {week.weekNumber} review</span>
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                  </div>
                </div>
              </div>
            </summary>

            <div className="border-t border-border p-4">
              <div className="grid gap-4 xl:grid-cols-2">
                {week.slots.map((slot) => {
                  const generated = Boolean(slot.body.trim() && slot.hashtags.length);
                  return (
                    <article key={slot.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold">{slot.platformLabel}</h4>
                        <Badge tone={generated ? "positive" : "muted"}>{generated ? formatStatus(slot.draftStatus) : "Not generated"}</Badge>
                      </div>

                      <div className="mt-4">
                        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-subtle-foreground">Generated copy</p>
                        <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-foreground">{slot.body.trim() || "Awo has not generated copy for this post yet."}</p>
                      </div>

                      <div className="mt-4">
                        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-subtle-foreground">Discovery hashtags</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {slot.hashtags.length ? slot.hashtags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">#{tag.replace(/^#+/, "")}</span>) : <span className="text-xs text-muted-foreground">No hashtags generated.</span>}
                        </div>
                      </div>

                      {slot.draftId ? (
                        <Button asChild size="sm" variant="secondary" className="mt-5 w-full">
                          <Link href={routes.organisations.content.draft(organisationId, slot.draftId)}>
                            Review, edit &amp; approve <ExternalLink className="size-3.5" aria-hidden />
                          </Link>
                        </Button>
                      ) : <Button size="sm" variant="secondary" className="mt-5 w-full" disabled>Draft not prepared</Button>}
                    </article>
                  );
                })}
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function formatStatus(status: string | null) {
  if (!status) return "Prepared";
  return status.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
