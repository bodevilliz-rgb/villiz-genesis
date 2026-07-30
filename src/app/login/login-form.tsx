"use client";
import { useActionState } from "react";
import { Mail } from "lucide-react";
import { requestSignInLink } from "@/server/actions/auth";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/common/form-message";

export function LoginForm() {
  const [state, formAction] = useActionState(requestSignInLink, idleState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field id="email" label="Work email" errors={state.fieldErrors?.email} required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@villiz.com"
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
      </Field>

      <SubmitButton size="lg" pendingLabel="Sending link…" className="w-full">
        <Mail aria-hidden />
        Email me a sign-in link
      </SubmitButton>

      <FormMessage state={state} />
    </form>
  );
}
