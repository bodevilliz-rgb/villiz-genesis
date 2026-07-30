import Link from "next/link";
import { Brain, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrganisationStatusBadge } from "@/components/common/status-badge";
import { ORGANISATION_ROLE_LABELS } from "@/core/domain/entities/identity";
import type { OrganisationSummary } from "@/core/domain/entities/organisation";
import { formatNumber, formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

export function OrganisationCard({ organisation }: { organisation: OrganisationSummary }) {
  return (
    <Card className="transition-colors hover:border-border-strong hover:bg-card-hover">
      <Link href={routes.organisations.detail(organisation.id)} className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: organisation.brandColour ?? "var(--border-strong)" }}
            />
            <h3 className="truncate text-sm font-medium">{organisation.name}</h3>
          </div>
          <OrganisationStatusBadge status={organisation.status} />
        </div>

        <p className="text-[12px] text-subtle-foreground">
          {organisation.industry ?? "No industry set"} · updated {formatRelative(organisation.updatedAt)}
        </p>

        <div className="mt-auto flex items-center gap-4 pt-2 font-mono text-[11px] text-subtle-foreground">
          <span className="flex items-center gap-1.5">
            <Brain className="size-3.5" aria-hidden />
            {formatNumber(organisation.membrainEntryCount)} entries
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden />
            {formatNumber(organisation.memberCount)}
          </span>
          {organisation.viewerRole ? (
            <Badge tone="muted" className="ml-auto">
              {ORGANISATION_ROLE_LABELS[organisation.viewerRole]}
            </Badge>
          ) : null}
        </div>
      </Link>
    </Card>
  );
}
