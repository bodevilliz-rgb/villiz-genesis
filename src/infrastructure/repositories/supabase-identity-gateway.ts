import "server-only";
import type { IdentityGateway } from "@/core/application/ports/identity-port";
import type { Actor, StaffProfile } from "@/core/domain/entities/identity";
import { UnauthenticatedError } from "@/core/domain/errors";
import type { GenesisClient } from "../supabase/server-client";
import type { ProfileRow } from "../supabase/database.types";
import { translateError } from "./errors";

function toStaffProfile(row: ProfileRow): StaffProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    jobTitle: row.job_title,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export class SupabaseIdentityGateway implements IdentityGateway {
  constructor(private readonly client: GenesisClient) {}

  async getActor(): Promise<Actor | null> {
    // getUser() revalidates the JWT with Supabase. getSession() reads an
    // unverified cookie and must never be used for authorisation.
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) return null;

    const { data, error } = await this.client
      .from("profiles")
      .select("*")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (error) translateError(error, "Profile lookup");
    if (!data) return null;

    const profile = toStaffProfile(data);
    return { ...profile, isPlatformAdmin: profile.role === "owner" || profile.role === "admin" };
  }

  async listActiveStaff(): Promise<StaffProfile[]> {
    const { data, error } = await this.client
      .from("profiles")
      .select("*")
      .eq("is_active", true)
      .order("full_name", { ascending: true, nullsFirst: false });

    if (error) translateError(error, "Staff directory");
    return (data ?? []).map(toStaffProfile);
  }

  async updateOwnProfile(input: { fullName: string | null; jobTitle: string | null }): Promise<void> {
    const { data: auth } = await this.client.auth.getUser();
    if (!auth.user) throw new UnauthenticatedError();

    const { error } = await this.client
      .from("profiles")
      .update({ full_name: input.fullName, job_title: input.jobTitle })
      .eq("id", auth.user.id);

    if (error) translateError(error, "Profile update");
  }
}
