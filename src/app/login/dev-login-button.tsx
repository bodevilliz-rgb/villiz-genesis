"use client";
import { useActionState } from "react";
import { Terminal } from "lucide-react";
import { devSignIn } from "@/server/actions/dev-auth";
import { idleState } from "@/server/action-result";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/common/form-message";

/**
 * Rendered only when the server has already confirmed both NODE_ENV and
 * ENABLE_DEV_LOGIN — see login-page. A single button, no free-text email
 * field, to keep the local shortcut boring: one seeded account, one click.
 */
export function DevLoginButton({ email }: { email: string }) {
  const [state, formAction] = useActionState(devSignIn, idleState);

  return (
    <div className="mt-6 flex flex-col gap-2 rounded-md border border-dashed border-warning/40 bg-warning-soft/40 p-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle-foreground">
        Local development only
      </p>
      <form action={formAction}>
        <input type="hidden" name="email" value={email} />
        <SubmitButton variant="secondary" size="sm" pendingLabel="Signing in…" className="w-full">
          <Terminal aria-hidden />
          Skip email — sign in as {email}
        </SubmitButton>
      </form>
      <FormMessage state={state} />
    </div>
  );
}
