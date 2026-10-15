"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import { Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { disconnectPublisherConnectionAction } from "@/server/actions/publisher-connections";
import { idleState } from "@/server/action-result";
import {
  PUBLISHER_CONNECTION_STATUS_LABELS,
  PUBLISHER_CONNECTION_STATUS_TONES,
  formatTokenExpiry,
  type PublisherConnection,
} from "@/core/domain/entities/publisher-connections";
import { formatDateTime } from "@/lib/format";

interface Props {
  connections: PublisherConnection[];
  canManage: boolean;
  /** Server-built initial countdown labels, keyed by account id: keeps the
   *  server render and the client's first paint byte-identical (no hydration
   *  mismatch) while the client clock takes over ticking after mount. */
  initialExpiryLabels: Record<string, string | null>;
}

/**
 * Ticking token-expiry countdown. Renders the server-computed label first,
 * then re-computes from the ISO timestamp every 30s on the client clock.
 */
function TokenExpiry({
  tokenExpiresAt,
  initialLabel,
}: {
  tokenExpiresAt: string | null;
  initialLabel: string | null;
}) {
  const [label, setLabel] = useState(initialLabel);

  useEffect(() => {
    if (!tokenExpiresAt) return;
    const update = () => setLabel(formatTokenExpiry(tokenExpiresAt, new Date()));
    update();
    const id: ReturnType<typeof setInterval> = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [tokenExpiresAt]);

  if (!label) return <span className="text-subtle-foreground">—</span>;
  return (
    <span className="font-mono text-[12px] tabular-nums" suppressHydrationWarning>
      {label}
    </span>
  );
}

function ReceiptList({ receipts }: { receipts: PublisherConnection["receipts"] }) {
  if (receipts.length === 0) {
    return (
      <p className="text-[12px] text-subtle-foreground">No publish receipts yet for this account.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {receipts.map((receipt) => (
        <li key={receipt.postSubmissionId} className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-mono text-muted-foreground">{receipt.postSubmissionId}</span>
          <Badge
            tone={receipt.status === "done" ? "positive" : receipt.status === "failed" ? "danger" : "neutral"}
          >
            {receipt.status}
          </Badge>
          {receipt.publicUrl ? (
            <a
              href={receipt.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              View post
            </a>
          ) : null}
          {receipt.createdAt ? (
            <span className="text-subtle-foreground">{formatDateTime(receipt.createdAt)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface RowProps {
  connection: PublisherConnection;
  canManage: boolean;
  initialLabel: string | null;
}

function ConnectionRow({ connection, canManage, initialLabel }: RowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionState, formAction] = useActionState(disconnectPublisherConnectionAction, idleState);
  const tone = PUBLISHER_CONNECTION_STATUS_TONES[connection.status];
  const visible = connection.status !== "disconnected";

  useEffect(() => {
    if (actionState.status === "success") {
      toast.success(actionState.message);
      setDialogOpen(false);
    } else if (actionState.status === "error") {
      toast.error(actionState.message);
    }
  }, [actionState]);

  return (
    <div className="flex flex-col gap-2">
      <div
        className={
          visible
            ? "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
            : "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-transparent px-4 py-3 opacity-70"
        }
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-[13px] font-medium">
            {connection.account ?? connection.id}
          </span>
          <span className="truncate font-mono text-[12px] text-muted-foreground">
            {[connection.id, connection.page].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted-foreground">Connected {formatDateTime(connection.connectedAt)}</span>
          {visible ? (
            <TokenExpiry tokenExpiresAt={connection.tokenExpiresAt} initialLabel={initialLabel} />
          ) : null}
          <Badge tone={tone}>
            {PUBLISHER_CONNECTION_STATUS_LABELS[connection.status]}
          </Badge>
          {canManage && visible ? (
            <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
              <Unplug aria-hidden /> Disconnect
            </Button>
          ) : null}
        </div>
      </div>
      {visible && connection.receipts.length > 0 ? (
        <details className="group rounded-lg border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground group-open:mb-2">
            Publish receipts ({connection.receipts.length})
          </summary>
          <ReceiptList receipts={connection.receipts} />
        </details>
      ) : null}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {connection.account ?? connection.id}?</DialogTitle>
            <DialogDescription>
              The hub immediately stops publishing through this account and keeps the token only as a
              tombstone alongside past receipts. Re-connect any time with the button above.
            </DialogDescription>
          </DialogHeader>
          <form action={formAction} className="flex items-center justify-end gap-2">
            <input type="hidden" name="accountId" value={connection.id} />
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Disconnecting…" variant="danger">
              Disconnect
            </SubmitButton>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Active connections first, then tombstoned history — hub order is storage order. */
function sortConnections(connections: PublisherConnection[]): PublisherConnection[] {
  return [...connections].sort((a, b) => {
    const aActive = a.status !== "disconnected" ? 0 : 1;
    const bActive = b.status !== "disconnected" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.id.localeCompare(b.id);
  });
}

export function ConnectedPublisherAccounts({
  connections,
  canManage,
  initialExpiryLabels,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      {sortConnections(connections).map((connection) => (
        <ConnectionRow
          key={connection.id}
          connection={connection}
          canManage={canManage}
          initialLabel={initialExpiryLabels[connection.id] ?? null}
        />
      ))}
    </div>
  );
}