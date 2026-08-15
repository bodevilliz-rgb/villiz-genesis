import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Brain, ClipboardCheck } from "lucide-react";

export type ExecutiveAttentionKind = "failure" | "review" | "readiness";

export interface ExecutiveAttentionItem {
  kind: ExecutiveAttentionKind;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
}

export function buildExecutiveAttention(input: {
  failedPublications: number;
  reviewsRequiringApproval: number;
  publishingHref: string;
  reviewHref: string;
  readiness?: Omit<ExecutiveAttentionItem, "kind">;
  readinessItems?: Array<Omit<ExecutiveAttentionItem, "kind">>;
}): ExecutiveAttentionItem[] {
  const items: ExecutiveAttentionItem[] = [];
  if (input.failedPublications > 0) {
    items.push({
      kind: "failure",
      title: `${input.failedPublications} failed ${input.failedPublications === 1 ? "publication" : "publications"}`,
      detail: "Publishing jobs currently require operator attention.",
      href: input.publishingHref,
      actionLabel: "Review failures",
    });
  }
  if (input.reviewsRequiringApproval > 0) {
    items.push({
      kind: "review",
      title: `${input.reviewsRequiringApproval} ${input.reviewsRequiringApproval === 1 ? "review requires" : "reviews require"} approval`,
      detail: "Drafts are waiting in the existing review workflow.",
      href: input.reviewHref,
      actionLabel: "Open Reviews Desk",
    });
  }
  const readinessItems = input.readinessItems ?? (input.readiness ? [input.readiness] : []);
  for (const readiness of readinessItems) items.push({ kind: "readiness", ...readiness });
  return items;
}

const ICONS = {
  failure: AlertTriangle,
  review: ClipboardCheck,
  readiness: Brain,
} as const;

export function ExecutiveAttention({ items }: { items: ExecutiveAttentionItem[] }) {
  return (
    <section aria-labelledby="executive-attention-heading" className="flex flex-col gap-3">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Priority actions</p>
        <h2 id="executive-attention-heading" className="mt-1 text-xl font-bold tracking-tight text-white">
          What needs your attention
        </h2>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <p className="text-[13px] font-medium text-white">No current action items</p>
          <p className="mt-1 text-[12px] text-subtle-foreground">No failures, pending approvals, or readiness warnings are present in tracked Genesis data.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            const isFailure = item.kind === "failure";
            return (
              <Link
                key={`${item.kind}-${item.href}`}
                href={item.href}
                aria-label={`${item.title}: ${item.actionLabel}`}
                className={`group flex min-h-32 flex-col justify-between rounded-lg border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  isFailure ? "border-danger/50 bg-danger-soft/40 hover:border-danger" : "border-border bg-card hover:border-primary/60"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${isFailure ? "text-danger" : "text-primary"}`} />
                  <div>
                    <h3 className="text-[14px] font-semibold text-white">{item.title}</h3>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
                <span className={`mt-4 inline-flex items-center gap-1 text-[12px] font-semibold ${isFailure ? "text-danger" : "text-primary"}`}>
                  {item.actionLabel} <ArrowUpRight aria-hidden className="size-3.5" />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
