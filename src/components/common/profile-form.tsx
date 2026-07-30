"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateProfileAction } from "@/server/actions/profile";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/common/form-message";
import type { Actor } from "@/core/domain/entities/identity";

export function ProfileForm({ actor }: { actor: Actor }) {
  const [state, formAction] = useActionState(updateProfileAction, idleState);

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field id="fullName" label="Full name" errors={state.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" maxLength={120} defaultValue={actor.fullName ?? ""} placeholder="Ada Okafor" />
      </Field>

      <Field id="jobTitle" label="Job title" hint="Optional" errors={state.fieldErrors?.jobTitle}>
        <Input
          id="jobTitle"
          name="jobTitle"
          maxLength={120}
          defaultValue={actor.jobTitle ?? ""}
          placeholder="Senior social strategist"
        />
      </Field>

      <FormMessage state={state} />

      <div>
        <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
      </div>
    </form>
  );
}
