"use client";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Unplug } from "lucide-react";
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
import { assignChannelAction, removeChannelAction } from "@/server/actions/organisation-social-accounts";
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

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onClose();
    }
    if (state.status === "error") toast.error(state.message);
  }, [state, onClose]);

  if (available.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No unassigned Blotato accounts are available. Run Test Connection in Publishing Settings to sync accounts first.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="organisationId" value={organisationId} />
      <div className="flex flex-col gap-2">
        {available.map((a) => (
          <label key={a.id} className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
            <input type="radio" name="blotatoAccountId" value={a.id} required className="accent-primary" />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium">{a.fullname ?? a.username ?? a.id}</span>
              <span className="text-[12px] text-muted-foreground">{platformLabel(a.platform)}</span>
            </span>
          </label>
        ))}
      </div>
      {state.status === "error" && (
        <p className="text-[13px] text-destructive">{state.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <SubmitButton size="sm">Connect channel</SubmitButton>
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
              <div className="flex items-center gap-3">
                <Badge tone="neutral" className="text-[11px]">
                  {platformLabel(ch.platform)}
                </Badge>
                <span className="text-[13px]">{ch.fullname ?? ch.username ?? ch.id}</span>
                {ch.username && ch.fullname && (
                  <span className="text-[12px] text-muted-foreground">@{ch.username}</span>
                )}
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
