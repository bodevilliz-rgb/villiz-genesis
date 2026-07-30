"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createOrganisationAction, updateOrganisationAction } from "@/server/actions/organisations";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/common/form-message";
import { ORGANISATION_STATUS_LABELS, type Organisation } from "@/core/domain/entities/organisation";
import { routes } from "@/lib/routes";

const STATUSES = Object.entries(ORGANISATION_STATUS_LABELS) as Array<[keyof typeof ORGANISATION_STATUS_LABELS, string]>;

export function OrganisationForm({ organisation }: { organisation?: Organisation }) {
  const isEdit = Boolean(organisation);
  const router = useRouter();
  const [state, formAction] = useActionState(
    isEdit ? updateOrganisationAction : createOrganisationAction,
    idleState,
  );

  // On creation, take the operator straight into the account they just opened.
  useEffect(() => {
    if (state.status === "success" && !isEdit && state.resourceId) {
      toast.success(state.message);
      router.push(routes.organisations.detail(state.resourceId));
    } else if (state.status === "success" && isEdit) {
      toast.success(state.message);
    }
  }, [state, isEdit, router]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {organisation ? <input type="hidden" name="id" value={organisation.id} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Client name" errors={state.fieldErrors?.name} required className="sm:col-span-2">
          <Input
            id="name"
            name="name"
            required
            maxLength={120}
            defaultValue={organisation?.name}
            placeholder="Northside Dental"
            aria-invalid={Boolean(state.fieldErrors?.name)}
          />
        </Field>

        <Field id="legalName" label="Registered name" hint="Optional" errors={state.fieldErrors?.legalName}>
          <Input
            id="legalName"
            name="legalName"
            maxLength={160}
            defaultValue={organisation?.legalName ?? ""}
            placeholder="Northside Dental Ltd"
          />
        </Field>

        <Field id="industry" label="Industry" hint="Optional" errors={state.fieldErrors?.industry}>
          <Input
            id="industry"
            name="industry"
            maxLength={80}
            defaultValue={organisation?.industry ?? ""}
            placeholder="Healthcare"
          />
        </Field>

        <Field id="websiteUrl" label="Website" hint="Optional" errors={state.fieldErrors?.websiteUrl}>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            defaultValue={organisation?.websiteUrl ?? ""}
            placeholder="https://example.com"
            aria-invalid={Boolean(state.fieldErrors?.websiteUrl)}
          />
        </Field>

        <Field id="status" label="Account status" errors={state.fieldErrors?.status}>
          <Select id="status" name="status" defaultValue={organisation?.status ?? "prospect"}>
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="primaryContactName"
          label="Main contact"
          hint="Optional"
          errors={state.fieldErrors?.primaryContactName}
        >
          <Input
            id="primaryContactName"
            name="primaryContactName"
            maxLength={120}
            defaultValue={organisation?.primaryContactName ?? ""}
            placeholder="Priya Shah"
          />
        </Field>

        <Field
          id="primaryContactEmail"
          label="Contact email"
          hint="For our records only"
          errors={state.fieldErrors?.primaryContactEmail}
        >
          <Input
            id="primaryContactEmail"
            name="primaryContactEmail"
            type="email"
            defaultValue={organisation?.primaryContactEmail ?? ""}
            placeholder="priya@example.com"
            aria-invalid={Boolean(state.fieldErrors?.primaryContactEmail)}
          />
        </Field>

        <Field
          id="brandColour"
          label="Brand colour"
          hint="Used to identify the account"
          errors={state.fieldErrors?.brandColour}
          className="sm:col-span-2"
        >
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Pick a brand colour"
              defaultValue={organisation?.brandColour ?? "#ff6a1f"}
              onChange={(event) => {
                const target = document.getElementById("brandColour") as HTMLInputElement | null;
                if (target) target.value = event.target.value.toUpperCase();
              }}
              className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-input p-1"
            />
            <Input
              id="brandColour"
              name="brandColour"
              defaultValue={organisation?.brandColour ?? ""}
              placeholder="#FF6A1F"
              className="font-mono"
              aria-invalid={Boolean(state.fieldErrors?.brandColour)}
            />
          </div>
        </Field>

        <Field
          id="notes"
          label="Account notes"
          hint="Internal, never shown to the client"
          errors={state.fieldErrors?.notes}
          className="sm:col-span-2"
        >
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            maxLength={5000}
            defaultValue={organisation?.notes ?? ""}
            placeholder="How this account runs: approval chain, sensitivities, anything the next person needs to know."
          />
        </Field>
      </div>

      <FormMessage state={state} />

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel={isEdit ? "Saving…" : "Creating…"}>
          {isEdit ? "Save changes" : "Create client account"}
        </SubmitButton>
        <Button asChild variant="ghost">
          <a href={organisation ? routes.organisations.detail(organisation.id) : routes.organisations.index}>
            Cancel
          </a>
        </Button>
      </div>
    </form>
  );
}
