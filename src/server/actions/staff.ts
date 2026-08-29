"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/server/container";
import { inviteStaff, updateStaff, updatePendingInvitation, deactivateStaff, reactivateStaff, permanentlyDeleteStaff, revokeInvitation, resendInvitation, type StaffAccess } from "@/server/staff-admin";
import { errorState, successState, text, type ActionState } from "../action-result";
import { routes } from "@/lib/routes";
import { canManagePlatformStaff } from "@/core/domain/entities/identity";

const role = z.enum(["owner", "admin", "member"]);
const orgRole = z.enum(["lead", "contributor", "reviewer"]);
function requireAdmin(actor: Parameters<typeof canManagePlatformStaff>[0]) { if (!canManagePlatformStaff(actor)) throw new Error("Only a platform administrator can manage staff."); }
function required(form: FormData, key: string) { const value = text(form, key); if (!value) throw new Error(`${key} is required.`); return value; }
function access(form: FormData): StaffAccess[] {
  const ids = form.get("allCurrentClients") === "yes" ? form.getAll("availableOrganisationId").map(String) : form.getAll("organisationId").map(String);
  return [...new Set(ids)].map((organisationId) => ({ organisationId, role: orgRole.parse(form.get(`role:${organisationId}`) ?? form.get("allClientsRole") ?? "contributor") }));
}
export async function inviteStaffAction(_p: ActionState, form: FormData): Promise<ActionState> { try { const c=await requireContext(); requireAdmin(c.actor); await inviteStaff({ name:required(form,"name"), email:required(form,"email"), platformRole:role.parse(form.get("platformRole")), access:access(form), invitedBy:c.actor.id }); revalidatePath(routes.team); return successState("Secure invitation sent."); } catch(e){ revalidatePath(routes.team); return errorState(e); } }
export async function updateStaffAction(_p: ActionState, form: FormData): Promise<ActionState> { try { const c=await requireContext(); requireAdmin(c.actor); await updateStaff({ profileId:required(form,"profileId"), platformRole:role.parse(form.get("platformRole")), access:access(form), actorId:c.actor.id }); revalidatePath(routes.team); return successState("Staff access updated."); } catch(e){ return errorState(e); } }
export async function deactivateStaffAction(_p: ActionState, form: FormData): Promise<ActionState> { try { const c=await requireContext(); requireAdmin(c.actor); await deactivateStaff(required(form,"profileId"),c.actor.id); revalidatePath(routes.team); return successState("Staff access deactivated. Historical work is preserved."); } catch(e){ return errorState(e); } }
export async function revokeInvitationAction(_p: ActionState, form: FormData): Promise<ActionState> { try { const c=await requireContext(); requireAdmin(c.actor); await revokeInvitation(required(form,"invitationId")); revalidatePath(routes.team); return successState("Invitation revoked."); } catch(e){ return errorState(e); } }
export async function resendInvitationAction(_p: ActionState, form: FormData): Promise<ActionState> { try { const c=await requireContext(); requireAdmin(c.actor); await resendInvitation(required(form,"invitationId")); return successState("A fresh secure invitation was sent."); } catch(e){ return errorState(e); } }
export async function updatePendingInvitationAction(_p: ActionState, form: FormData): Promise<ActionState> { try { const c=await requireContext(); requireAdmin(c.actor); await updatePendingInvitation({ invitationId:required(form,"invitationId"), platformRole:role.parse(form.get("platformRole")), access:access(form), actorId:c.actor.id }); revalidatePath(routes.team); return successState("Pending access updated."); } catch(e){ return errorState(e); } }
export async function reactivateStaffAction(_p: ActionState, form: FormData): Promise<ActionState> { try { const c=await requireContext(); requireAdmin(c.actor); await reactivateStaff({ profileId:required(form,"profileId"), platformRole:role.parse(form.get("platformRole")), access:access(form), actorId:c.actor.id }); revalidatePath(routes.team); return successState("Staff access reactivated and a fresh secure invitation sent."); } catch(e){ revalidatePath(routes.team); return errorState(e); } }
export async function permanentlyDeleteStaffAction(_p: ActionState, form: FormData): Promise<ActionState> { try { const c=await requireContext(); requireAdmin(c.actor); if (required(form,"confirmPermanentDelete") !== "yes") throw new Error("Confirm permanent deletion before continuing."); await permanentlyDeleteStaff(required(form,"profileId"),c.actor.id); revalidatePath(routes.team); return successState("Unused staff identity permanently deleted."); } catch(e){ return errorState(e); } }
