"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { PlugZap } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { testBlotatoConnectionAction } from "@/server/actions/blotato";
import { idleState } from "@/server/action-result";

/**
 * Requirement 6 — the button reports API reachability, connected accounts,
 * and supported platforms via the toast (a transient one-line summary); the
 * full, persistent report is the accounts table this panel's parent page
 * renders below it, which re-fetches from the database after the action
 * revalidates the page (see server/actions/blotato.ts).
 */
export function BlotatoConnectionPanel({ canTestConnection }: { canTestConnection: boolean }) {
  const [state, action] = useActionState(testBlotatoConnectionAction, idleState);

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);

  if (!canTestConnection) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Only platform administrators can test the Blotato connection. Ask one to run it if the accounts below look
        out of date.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <SubmitButton variant="primary" pendingLabel="Testing connection…">
        <PlugZap aria-hidden />
        Test Connection
      </SubmitButton>
      {state.status === "error" ? <p className="text-[12px] text-danger">{state.message}</p> : null}
      {state.status === "success" ? <p className="text-[12px] text-positive">{state.message}</p> : null}
    </form>
  );
}
