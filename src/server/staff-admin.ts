import "server-only";
import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import { isAllowedEmail, serverEnv } from "@/lib/env";
import { routes } from "@/lib/routes";
import type { PlatformRole, OrganisationRole } from "@/core/domain/entities/identity";
import { ConflictError, InfrastructureError, LimitExceededError } from "@/core/domain/errors";

export type StaffAccess = { organisationId: string; role: OrganisationRole };
export type StaffAdminRow = {
  id: string; email: string; fullName: string | null; platformRole: PlatformRole;
  isActive: boolean; status: "Active" | "Pending" | "Revoked";
  memberships: StaffAccess[]; invitationId: string | null;
};

export async function listStaffAdmin(): Promise<StaffAdminRow[]> {
  const admin = createAdminClient();
  const [{ data: profiles, error: profileError }, { data: members, error: memberError }, { data: invitations, error: inviteError }, { data: authUsers }] = await Promise.all([
    admin.from("profiles").select("id,email,full_name,role,is_active").order("full_name"),
    admin.from("organisation_members").select("profile_id,organisation_id,role"),
    admin.from("staff_invitations").select("id,email,status,organisation_access").order("invited_at", { ascending: false }),
    admin.auth.admin.listUsers(),
  ]);
  if (profileError || memberError || inviteError) throw profileError ?? memberError ?? inviteError;
  const signedIn = new Set((authUsers?.users ?? []).filter((u) => u.last_sign_in_at).map((u) => u.email?.toLowerCase()));
  const acceptedIds = (invitations ?? []).filter((i) => i.status === "pending" && signedIn.has(i.email)).map((i) => i.id);
  if (acceptedIds.length) await admin.from("staff_invitations").update({ status: "accepted", accepted_at: new Date().toISOString() }).in("id", acceptedIds);
  const latest = new Map((invitations ?? []).map((i) => [i.email, acceptedIds.includes(i.id) ? { ...i, status: "accepted" as const } : i]));
  return (profiles ?? []).map((p) => {
    const invitation = latest.get(p.email);
    return {
      id: p.id, email: p.email, fullName: p.full_name, platformRole: p.role, isActive: p.is_active,
      status: invitation?.status === "pending" ? "Pending" : invitation?.status === "revoked" ? "Revoked" : p.is_active ? "Active" : "Revoked",
      memberships: (members ?? []).filter((m) => m.profile_id === p.id).map((m) => ({ organisationId: m.organisation_id, role: m.role })),
      invitationId: invitation?.id ?? null,
    };
  });
}

export async function resendInvitation(invitationId: string) {
  const admin = createAdminClient();
  const { data: invitation, error } = await admin.from("staff_invitations").select("email,status").eq("id", invitationId).single();
  if (error) throw error;
  if (invitation.status !== "pending") throw new ConflictError("Only pending invitations can be resent.");
  const { error: sendError } = await admin.auth.signInWithOtp({ email: invitation.email, options: { shouldCreateUser: false, emailRedirectTo: `${serverEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}${routes.authAccept}` } });
  if (sendError) throw staffEmailError(sendError);
}

function staffEmailError(error: { status?: number; code?: string }): Error {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return new LimitExceededError("Staff access is ready, but the email service is temporarily busy. Use Resend invite in a few minutes.");
  }
  return new InfrastructureError("Staff access is ready, but the invitation email could not be sent. Use Resend invite to try again.");
}

export async function inviteStaff(input: { name: string; email: string; platformRole: PlatformRole; access: StaffAccess[]; invitedBy: string }) {
  const admin = createAdminClient();
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!isAllowedEmail(email)) throw new Error("This email is outside the authorised Genesis staff domains.");
  const { data: existingInvite } = await admin.from("staff_invitations").select("id").eq("email", email).eq("status", "pending").maybeSingle();
  if (existingInvite) throw new Error("A pending invitation already exists for this email.");

  const { data: invitation, error: invitationError } = await admin.from("staff_invitations").insert({
    email, full_name: input.name.trim(), platform_role: input.platformRole,
    organisation_access: input.access, status: "pending", invited_by: input.invitedBy,
  }).select("id").single();
  if (invitationError) throw invitationError;

  const { data: users, error: usersError } = await admin.auth.admin.listUsers();
  if (usersError) {
    await admin.from("staff_invitations").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", invitation.id);
    throw usersError;
  }
  const existingUser = users.users.find((user) => user.email?.toLowerCase() === email);
  const result = existingUser ? { data: { user: existingUser }, error: null } : await admin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { full_name: input.name.trim(), genesis_invitation_id: invitation.id },
  });
  if (result.error || !result.data.user) {
    await admin.from("staff_invitations").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", invitation.id);
    throw result.error ?? new Error("Supabase did not create the invited identity.");
  }
  const { error: preparationError } = await admin.rpc("admin_prepare_staff_invitation", { p_actor_id: input.invitedBy, p_invitation_id: invitation.id, p_profile_id: result.data.user.id });
  if (preparationError) {
    await admin.from("staff_invitations").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", invitation.id);
    if (!existingUser) await admin.auth.admin.deleteUser(result.data.user.id);
    throw preparationError;
  }

  const { error: sendError } = await admin.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${serverEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}${routes.authAccept}` } });
  if (sendError) throw staffEmailError(sendError);
}

export async function updateStaff(input: { profileId: string; platformRole: PlatformRole; access: StaffAccess[]; actorId: string }) {
  const admin = createAdminClient();
  if (input.profileId === input.actorId && input.platformRole === "member") throw new Error("You cannot remove your own administrator access.");
  const { data: current, error: currentError } = await admin.from("profiles").select("full_name,is_active").eq("id", input.profileId).single();
  if (currentError) throw currentError;
  const { error } = await admin.rpc("admin_set_staff_profile", { p_actor_id: input.actorId, p_profile_id: input.profileId, p_full_name: current.full_name ?? "", p_role: input.platformRole, p_is_active: current.is_active });
  if (error) throw error;
  await admin.from("organisation_members").delete().eq("profile_id", input.profileId);
  if (input.access.length) {
    const { error: accessError } = await admin.from("organisation_members").insert(input.access.map((a) => ({ organisation_id: a.organisationId, profile_id: input.profileId, role: a.role, assigned_by: input.actorId })));
    if (accessError) throw accessError;
  }
}

export async function deactivateStaff(profileId: string, actorId: string) {
  if (profileId === actorId) throw new Error("You cannot deactivate your own account.");
  const admin = createAdminClient();
  const { data: current, error: currentError } = await admin.from("profiles").select("full_name,role").eq("id", profileId).single();
  if (currentError) throw currentError;
  const { error } = await admin.rpc("admin_set_staff_profile", { p_actor_id: actorId, p_profile_id: profileId, p_full_name: current.full_name ?? "", p_role: current.role, p_is_active: false });
  if (error) throw error;
  await admin.from("organisation_members").delete().eq("profile_id", profileId);
}

export async function revokeInvitation(invitationId: string) {
  const admin = createAdminClient();
  const { data: invitation, error } = await admin.from("staff_invitations").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", invitationId).eq("status", "pending").select("email").maybeSingle();
  if (error) throw error;
  if (!invitation) throw new Error("This invitation is no longer pending.");
  const { data } = await admin.auth.admin.listUsers();
  const user = data.users.find((candidate) => candidate.email?.toLowerCase() === invitation.email);
  if (user && !user.last_sign_in_at) {
    const { data: inviter } = await admin.from("staff_invitations").select("invited_by").eq("id", invitationId).single();
    const { data: current } = await admin.from("profiles").select("full_name,role").eq("id", user.id).single();
    if (inviter && current) await admin.rpc("admin_set_staff_profile", { p_actor_id: inviter.invited_by, p_profile_id: user.id, p_full_name: current.full_name ?? "", p_role: current.role, p_is_active: false });
    await admin.from("organisation_members").delete().eq("profile_id", user.id);
  }
}
