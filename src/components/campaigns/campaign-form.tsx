"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCampaignAction, updateCampaignAction } from "@/server/actions/campaigns";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/common/form-message";
import {
  CAMPAIGN_PLATFORM_LABELS,
  type Campaign,
  type CampaignPlatform,
} from "@/core/domain/entities/campaign";
import { routes } from "@/lib/routes";

/** Excludes "archived" — that transition only happens through the dedicated Archive action. */
const EDITABLE_STATUSES = ["planning", "active", "completed"] as const;
const EDITABLE_STATUS_LABELS: Record<(typeof EDITABLE_STATUSES)[number], string> = {
  planning: "Planning",
  active: "Active",
  completed: "Completed",
};

const PLATFORMS = Object.keys(CAMPAIGN_PLATFORM_LABELS) as CampaignPlatform[];

export function CampaignForm({ organisationId, campaign }: { organisationId: string; campaign?: Campaign }) {
  const isEdit = Boolean(campaign);
  const router = useRouter();
  const [state, formAction] = useActionState(isEdit ? updateCampaignAction : createCampaignAction, idleState);

  useEffect(() => {
    if (state.status === "success" && state.resourceId) {
      toast.success(state.message);
      router.push(routes.organisations.campaigns.detail(organisationId, state.resourceId));
    } else if (state.status === "error") {
      toast.error(state.message);
    }
  }, [state, organisationId, router]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="organisationId" value={organisationId} />
      {campaign ? <input type="hidden" name="id" value={campaign.id} /> : null}

      <Field id="name" label="Campaign name" errors={state.fieldErrors?.name} required>
        <Input
          id="name"
          name="name"
          required
          maxLength={200}
          defaultValue={campaign?.name}
          placeholder="Spring new-patient promotion"
          aria-invalid={Boolean(state.fieldErrors?.name)}
          className="text-base font-medium"
        />
      </Field>

      <Field
        id="objective"
        label="Objective"
        hint="What this campaign is trying to achieve"
        errors={state.fieldErrors?.objective}
      >
        <Textarea
          id="objective"
          name="objective"
          rows={2}
          maxLength={500}
          defaultValue={campaign?.objective ?? ""}
          placeholder="Fill 15 new-patient appointment slots in March"
        />
      </Field>

      <Field id="description" label="Description" hint="Optional" errors={state.fieldErrors?.description}>
        <Textarea
          id="description"
          name="description"
          rows={4}
          maxLength={5000}
          defaultValue={campaign?.description ?? ""}
          placeholder="Internal notes: how this campaign came about, any constraints the team should know."
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="targetAudience"
          label="Target audience"
          hint="Optional"
          errors={state.fieldErrors?.targetAudience}
          className="sm:col-span-2"
        >
          <Textarea
            id="targetAudience"
            name="targetAudience"
            rows={2}
            maxLength={1000}
            defaultValue={campaign?.targetAudience ?? ""}
            placeholder="Existing patients who haven't booked in 12+ months"
          />
        </Field>

        <Field
          id="primaryCTA"
          label="Primary call to action"
          hint="Optional"
          errors={state.fieldErrors?.primaryCTA}
          className="sm:col-span-2"
        >
          <Input
            id="primaryCTA"
            name="primaryCTA"
            maxLength={300}
            defaultValue={campaign?.primaryCTA ?? ""}
            placeholder="Book your check-up today"
          />
        </Field>

        <Field id="startDate" label="Start date" hint="Optional" errors={state.fieldErrors?.startDate}>
          <Input id="startDate" name="startDate" type="date" defaultValue={campaign?.startDate ?? ""} />
        </Field>

        <Field id="endDate" label="End date" hint="Optional" errors={state.fieldErrors?.endDate}>
          <Input id="endDate" name="endDate" type="date" defaultValue={campaign?.endDate ?? ""} />
        </Field>

        <Field id="status" label="Status" errors={state.fieldErrors?.status}>
          <Select id="status" name="status" defaultValue={campaign?.status ?? "planning"}>
            {EDITABLE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {EDITABLE_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="successMetric"
          label="Success metric"
          hint="Optional · how you'll know it worked"
          errors={state.fieldErrors?.successMetric}
        >
          <Input
            id="successMetric"
            name="successMetric"
            maxLength={300}
            defaultValue={campaign?.successMetric ?? ""}
            placeholder="15 bookings attributed to this campaign"
          />
        </Field>

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium">Platforms</p>
          <p className="mb-2 text-[11px] text-subtle-foreground">Optional · which channels this campaign is planned for</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  name="platforms"
                  value={platform}
                  defaultChecked={campaign?.platforms.includes(platform) ?? false}
                  className="size-4 rounded border-border-strong accent-primary"
                />
                {CAMPAIGN_PLATFORM_LABELS[platform]}
              </label>
            ))}
          </div>
        </div>
      </div>

      <FormMessage state={state} />

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel={isEdit ? "Saving…" : "Creating…"}>
          {isEdit ? "Save changes" : "Create campaign"}
        </SubmitButton>
        <Button asChild variant="ghost">
          <a
            href={
              campaign
                ? routes.organisations.campaigns.detail(organisationId, campaign.id)
                : routes.organisations.campaigns.index(organisationId)
            }
          >
            Cancel
          </a>
        </Button>
      </div>
    </form>
  );
}
