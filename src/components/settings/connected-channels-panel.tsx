"use client";
import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  assignChannelAction,
  refreshAvailableChannelsAction,
  removeChannelAction,
  type RefreshAvailableChannelsState,
} from "@/server/actions/organisation-social-accounts";
import { idleState } from "@/server/action-result";
import type { BlotatoAccount } from "@/core/domain/entities/blotato";
import { PUBLISHING_PLATFORM_LABELS } from "@/core/domain/entities/publishing";
import { mapBlotatoPlatform } from "@/core/domain/entities/blotato";

interface Props {
  organisationId: string;
  channels: BlotatoAccount[];
  available: BlotatoAccount[];
  canManage: boolean;
  maxChannels: number;
}

function platformLabel(blotatoPlatform: string): string {
  const p = mapBlotatoPlatform(blotatoPlatform);
  return p ? PUBLISHING_PLATFORM_LABELS[p] : blotatoPlatform;
}

/**
 * The human-recognisable social identity for an account.
 * Priority: @username > fullname > provider account ID (fallback).
 * fullname is deliberately lower-priority because Blotato sometimes
 * populates it with the platform name ("Instagram"), which is indistinguishable
 * across multiple accounts on the same platform.
 */
function accountHandle(a: Pick<BlotatoAccount, "username" | "fullname" | "id">): string {
  if (a.username) return `@${a.username}`;
  if (a.fullname) return a.fullname;
  return a.id;
}

function AssignForm({
  organisationId,
  available,
  onClose,
}: {
  organisationId: string;
  available: BlotatoAccount[];
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(assignChannelAction, idleState);
  const initialRefreshState: RefreshAvailableChannelsState = {
    status: "idle",
    message: "",
    accounts: available,
  };
  const [refreshState, refreshAction, refreshPending] = useActionState(
    refreshAvailableChannelsAction,
    initialRefreshState,
  );
  const refreshedAccounts = refreshState.status === "idle" ? available : refreshState.accounts;

  function refreshAccounts() {
    const formData = new FormData();
    formData.set("organisationId", organisationId);
    startTransition(() => refreshAction(formData));
  }

  // Dialog content mounts when opened, so every open performs a fresh provider
  // sync. The selector never depends solely on a stale database snapshot.
  useEffect(() => {
    refreshAccounts();
    // The organisation is stable for this mounted dialog. refreshAction is a
    // React action dispatcher and does not need to retrigger this one-shot sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisationId]);

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onClose();
    }
    if (state.status === "error") toast.error(state.message);
  }, [state, onClose]);

  if (refreshPending && refreshedAccounts.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
        Refreshing accounts from Blotato…
      </div>
    );
  }

  if (refreshState.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-destructive">{refreshState.message}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="secondary" size="sm" onClick={refreshAccounts}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (refreshState.status === "success" && refreshedAccounts.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted-foreground">{refreshState.message}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
          <Button type="button" variant="secondary" size="sm" onClick={refreshAccounts}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh accounts
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="organisationId" value={organisationId} />
      {refreshPending ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground" role="status">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking for newly connected accounts…
        </div>
      ) : null}
      <fieldset disabled={refreshPending} className="flex flex-col gap-2">
        {refreshedAccounts.map((a) => (
            <label
              key={a.id}
              className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
            >
              <input
                type="radio"
                name="blotatoAccountId"
                value={a.id}
                required
                className="accent-primary"
                aria-label={`${platformLabel(a.platform)} ${accountHandle(a)}`}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">{platformLabel(a.platform)}</span>
                <span className="text-[12px]">{accountHandle(a)}</span>
                <span className="text-[11px] text-muted-foreground">Blotato</span>
              </span>
            </label>
          ))}
      </fieldset>
      {state.status === "error" && (
        <p className="text-[13px] text-destructive">{state.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <SubmitButton size="sm" disabled={refreshPending}>Connect channel</SubmitButton>
      </div>
    </form>
  );
}

function RemoveForm({
  organisationId,
  account,
}: {
  organisationId: string;
  account: BlotatoAccount;
}) {
  const [state, formAction] = useActionState(removeChannelAction, idleState);

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="blotatoAccountId" value={account.id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        title="Remove channel"
      >
        <Unplug className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}

export function ConnectedChannelsPanel({ organisationId, channels, available, canManage, maxChannels }: Props) {
  const [assignOpen, setAssignOpen] = useState(false);
  const atLimit = channels.length >= maxChannels;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {channels.length} of {maxChannels} channels connected.
        </p>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            disabled={atLimit}
            onClick={() => setAssignOpen(true)}
            title={atLimit ? `Channel limit of ${maxChannels} reached` : undefined}
          >
            + Connect channel
          </Button>
        )}
      </div>

      {channels.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No channels connected. {canManage ? "Click “+ Connect channel” to assign one." : "Ask a platform administrator to connect one."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {channels.map((ch) => (
            <li key={ch.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral" className="text-[11px]">
                    {platformLabel(ch.platform)}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">Blotato</span>
                  <Badge tone="positive" className="text-[11px]">Connected</Badge>
                </div>
                <span className="text-[13px] font-medium">{accountHandle(ch)}</span>
              </div>
              {canManage && <RemoveForm organisationId={organisationId} account={ch} />}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a channel</DialogTitle>
            <DialogDescription>
              Select an unassigned Blotato account to connect to this organisation.
            </DialogDescription>
          </DialogHeader>
          <AssignForm
            organisationId={organisationId}
            available={available}
            onClose={() => setAssignOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
