"use client";
import { useActionState } from "react";
import { inviteStaffAction, updateStaffAction, deactivateStaffAction, revokeInvitationAction, resendInvitationAction } from "@/server/actions/staff";
import { idleState } from "@/server/action-result";
import type { StaffAdminRow } from "@/server/staff-admin";
import type { OrganisationSummary } from "@/core/domain/entities/organisation";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/common/form-message";

function ClientAccess({ organisations, current = [] }: { organisations: OrganisationSummary[]; current?: StaffAdminRow["memberships"] }) {
  const assigned = new Map(current.map((m) => [m.organisationId, m.role]));
  return <fieldset className="grid gap-2"><legend className="mb-2 text-xs font-medium">Client access</legend>{organisations.map((org) => <input key={`available-${org.id}`} type="hidden" name="availableOrganisationId" value={org.id}/>)}<label className="mb-2 flex items-center gap-2 rounded border border-border p-2 text-sm"><input type="checkbox" name="allCurrentClients" value="yes"/><span className="flex-1">All current clients</span><Select name="allClientsRole" defaultValue="contributor" className="h-8 w-36"><option value="lead">Account Lead</option><option value="contributor">Creator</option><option value="reviewer">Reviewer</option></Select></label><span className="text-xs text-muted-foreground">Or choose selected clients:</span>{organisations.map((org) => <label key={org.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="organisationId" value={org.id} defaultChecked={assigned.has(org.id)} /><span className="flex-1">{org.name}</span><Select name={`role:${org.id}`} defaultValue={assigned.get(org.id) ?? "contributor"} className="h-8 w-36"><option value="lead">Account Lead</option><option value="contributor">Creator</option><option value="reviewer">Reviewer</option></Select></label>)}</fieldset>;
}

export function StaffManager({ staff, organisations }: { staff: StaffAdminRow[]; organisations: OrganisationSummary[] }) {
  const [inviteState, inviteAction] = useActionState(inviteStaffAction, idleState);
  return <div className="space-y-6">
    <details className="rounded-lg border border-border bg-card p-5"><summary className="cursor-pointer font-medium">Add Staff</summary><form action={inviteAction} className="mt-5 grid gap-4"><div className="grid gap-3 sm:grid-cols-3"><Input name="name" placeholder="Name" required /><Input name="email" type="email" placeholder="Email" required /><Select name="platformRole" defaultValue="member"><option value="member">Team member</option><option value="admin">Admin</option></Select></div><ClientAccess organisations={organisations}/><FormMessage state={inviteState}/><div><SubmitButton pendingLabel="Sending…">Send Invite</SubmitButton></div></form></details>
    <div className="space-y-3">{staff.map((person) => <StaffRow key={person.id} person={person} organisations={organisations}/>)}</div>
  </div>;
}

function StaffRow({ person, organisations }: { person: StaffAdminRow; organisations: OrganisationSummary[] }) {
  const [updateState, updateAction] = useActionState(updateStaffAction, idleState);
  const [, deactivateAction] = useActionState(deactivateStaffAction, idleState);
  const [, revokeAction] = useActionState(revokeInvitationAction, idleState);
  const [, resendAction] = useActionState(resendInvitationAction, idleState);
  return <details className="rounded-lg border border-border bg-card p-4"><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center gap-3"><span className="min-w-0 flex-1"><strong className="block text-sm">{person.fullName ?? "Invite Pending"}</strong><span className="text-xs text-muted-foreground">{person.email}</span></span><span className="text-xs">{person.platformRole === "admin" || person.platformRole === "owner" ? "Admin" : "Team member"}</span><span className="text-xs text-muted-foreground">{person.memberships.length === organisations.length && organisations.length ? "All clients" : `${person.memberships.length} client${person.memberships.length === 1 ? "" : "s"}`}</span><span className="text-xs">{person.status}</span></div></summary><div className="mt-4 border-t border-border pt-4">{person.status === "Pending" && person.invitationId ? <div className="flex gap-2"><form action={resendAction}><input type="hidden" name="invitationId" value={person.invitationId}/><SubmitButton size="sm" pendingLabel="Sending…">Resend invite</SubmitButton></form><form action={revokeAction}><input type="hidden" name="invitationId" value={person.invitationId}/><SubmitButton size="sm" variant="danger" pendingLabel="Revoking…">Revoke invite</SubmitButton></form></div> : <form action={updateAction} className="grid gap-4"><input type="hidden" name="profileId" value={person.id}/><label className="text-xs font-medium">Platform role<Select name="platformRole" defaultValue={person.platformRole} className="mt-1"><option value="member">Team member</option><option value="admin">Admin</option>{person.platformRole === "owner" ? <option value="owner">Owner</option> : null}</Select></label><ClientAccess organisations={organisations} current={person.memberships}/><FormMessage state={updateState}/><div className="flex gap-2"><SubmitButton size="sm" pendingLabel="Saving…">Save access</SubmitButton></div></form>}{person.status === "Active" && person.platformRole !== "owner" ? <form action={deactivateAction} className="mt-3"><input type="hidden" name="profileId" value={person.id}/><SubmitButton size="sm" variant="danger" pendingLabel="Removing…">Remove staff access</SubmitButton></form> : null}</div></details>;
}
