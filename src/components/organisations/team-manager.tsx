"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { assignMemberAction, removeMemberAction } from "@/server/actions/organisations";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/common/form-message";
import { ConfirmSubmit } from "@/components/common/confirm-submit";
import {
  ORGANISATION_ROLE_DESCRIPTIONS,
  ORGANISATION_ROLE_LABELS,
  type OrganisationRole,
  type StaffProfile,
} from "@/core/domain/entities/identity";
import type { OrganisationMember } from "@/core/domain/entities/organisation";

const ROLES = Object.keys(ORGANISATION_ROLE_LABELS) as OrganisationRole[];

export function TeamManager({
  organisationId,
  members,
  staff,
  canManage,
}: {
  organisationId: string;
  members: OrganisationMember[];
  staff: StaffProfile[];
  canManage: boolean;
}) {
  const [assignState, assignAction] = useActionState(assignMemberAction, idleState);
  const [removeState, removeAction] = useActionState(removeMemberAction, idleState);

  useEffect(() => {
    if (assignState.status === "success") toast.success(assignState.message);
    if (assignState.status === "error") toast.error(assignState.message);
  }, [assignState]);

  useEffect(() => {
    if (removeState.status === "success") toast.success(removeState.message);
    if (removeState.status === "error") toast.error(removeState.message);
  }, [removeState]);

  const assigned = new Set(members.map((m) => m.profileId));
  const available = staff.filter((person) => !assigned.has(person.id));

  return (
    <div className="flex flex-col gap-6">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {members.length === 0 ? (
          <li className="px-5 py-6 text-center text-[13px] text-subtle-foreground">
            Nobody is assigned to this account yet.
          </li>
        ) : (
          members.map((member) => (
            <li key={member.profileId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {member.profile.fullName ?? member.profile.email}
                </span>
                <span className="block truncate text-[12px] text-subtle-foreground">
                  {member.profile.jobTitle ?? member.profile.email}
                </span>
              </span>

              {canManage ? (
                <form action={assignAction} className="flex items-center gap-2">
                  <input type="hidden" name="organisationId" value={organisationId} />
                  <input type="hidden" name="profileId" value={member.profileId} />
                  <Select
                    name="role"
                    defaultValue={member.role}
                    aria-label={`Role for ${member.profile.fullName ?? member.profile.email}`}
                    className="h-8 w-40 text-[13px]"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ORGANISATION_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                    Update
                  </SubmitButton>
                </form>
              ) : (
                <Badge tone={member.role === "lead" ? "accent" : "muted"}>
                  {ORGANISATION_ROLE_LABELS[member.role]}
                </Badge>
              )}

              {canManage ? (
                <form action={removeAction}>
                  <input type="hidden" name="organisationId" value={organisationId} />
                  <input type="hidden" name="profileId" value={member.profileId} />
                  <ConfirmSubmit
                    size="sm"
                    variant="ghost"
                    message={`Remove ${member.profile.fullName ?? member.profile.email} from this account?`}
                  >
                    Remove
                  </ConfirmSubmit>
                </form>
              ) : null}
            </li>
          ))
        )}
      </ul>

      {canManage ? (
        <form action={assignAction} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
          <input type="hidden" name="organisationId" value={organisationId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="profileId" label="Colleague" required>
              <Select id="profileId" name="profileId" required defaultValue="">
                <option value="" disabled>
                  {available.length === 0 ? "Everyone is already assigned" : "Choose a colleague"}
                </option>
                {available.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName ?? person.email}
                  </option>
                ))}
              </Select>
            </Field>

            <Field id="role" label="Role" hint="Controls what they can change">
              <Select id="role" name="role" defaultValue="contributor">
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ORGANISATION_ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <dl className="grid gap-2 text-[12px] text-subtle-foreground sm:grid-cols-3">
            {ROLES.map((role) => (
              <div key={role}>
                <dt className="font-medium text-muted-foreground">{ORGANISATION_ROLE_LABELS[role]}</dt>
                <dd>{ORGANISATION_ROLE_DESCRIPTIONS[role]}</dd>
              </div>
            ))}
          </dl>

          <FormMessage state={assignState} />

          <div>
            <SubmitButton pendingLabel="Adding…" disabled={available.length === 0}>
              <UserPlus aria-hidden />
              Add to this account
            </SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
