"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateLimitsAction } from "@/server/actions/organisations";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/common/form-message";
import type { OrganisationUsage } from "@/core/domain/entities/usage";

const GIB = 1024 * 1024 * 1024;

export function LimitsForm({ organisationId, usage }: { organisationId: string; usage: OrganisationUsage }) {
  const [state, formAction] = useActionState(updateLimitsAction, idleState);

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="organisationId" value={organisationId} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="maxSocialAccounts"
          label="Connected channels"
          hint={`${usage.socialAccountsUsed} in use`}
          errors={state.fieldErrors?.maxSocialAccounts}
        >
          <Input id="maxSocialAccounts" name="maxSocialAccounts" type="number" min={0} max={500} defaultValue={usage.maxSocialAccounts} />
        </Field>

        <Field
          id="maxPostsPerWeek"
          label="Posts per week"
          hint={`${usage.postsThisWeek} this week`}
          errors={state.fieldErrors?.maxPostsPerWeek}
        >
          <Input id="maxPostsPerWeek" name="maxPostsPerWeek" type="number" min={0} max={5000} defaultValue={usage.maxPostsPerWeek} />
        </Field>

        <Field id="maxStorageGb" label="Media storage (GB)" errors={state.fieldErrors?.maxStorageGb}>
          <Input
            id="maxStorageGb"
            name="maxStorageGb"
            type="number"
            min={0}
            step={0.5}
            defaultValue={(usage.maxStorageBytes / GIB).toFixed(1)}
          />
        </Field>

        <Field
          id="maxAiTokensPerMonth"
          label="AI tokens per month"
          errors={state.fieldErrors?.maxAiTokensPerMonth}
        >
          <Input
            id="maxAiTokensPerMonth"
            name="maxAiTokensPerMonth"
            type="number"
            min={0}
            step={100000}
            defaultValue={usage.maxAiTokensPerMonth}
          />
        </Field>

        <Field
          id="maxMembrainEntries"
          label="MemBrain entries"
          hint={`${usage.membrainEntriesUsed} stored`}
          errors={state.fieldErrors?.maxMembrainEntries}
          className="sm:col-span-2"
        >
          <Input
            id="maxMembrainEntries"
            name="maxMembrainEntries"
            type="number"
            min={0}
            defaultValue={usage.maxMembrainEntries}
          />
        </Field>
      </div>

      <FormMessage state={state} />

      <div>
        <SubmitButton pendingLabel="Saving…">Save limits</SubmitButton>
      </div>
    </form>
  );
}
