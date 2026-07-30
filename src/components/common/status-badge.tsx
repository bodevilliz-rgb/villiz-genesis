import { Badge } from "@/components/ui/badge";
import {
  ORGANISATION_STATUS_LABELS,
  ORGANISATION_STATUS_TONE,
  type OrganisationStatus,
} from "@/core/domain/entities/organisation";
import { MEMBRAIN_STATUS_LABELS, type MembrainStatus } from "@/core/domain/entities/membrain";

export function OrganisationStatusBadge({ status }: { status: OrganisationStatus }) {
  return <Badge tone={ORGANISATION_STATUS_TONE[status]}>{ORGANISATION_STATUS_LABELS[status]}</Badge>;
}

const MEMBRAIN_TONE: Record<MembrainStatus, "positive" | "warning" | "muted"> = {
  active: "positive",
  draft: "warning",
  archived: "muted",
};

export function MembrainStatusBadge({ status }: { status: MembrainStatus }) {
  return <Badge tone={MEMBRAIN_TONE[status]}>{MEMBRAIN_STATUS_LABELS[status]}</Badge>;
}
