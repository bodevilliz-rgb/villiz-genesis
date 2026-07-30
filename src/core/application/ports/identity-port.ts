import type { Actor, StaffProfile } from "@/core/domain/entities/identity";

/**
 * Everything the application layer is allowed to know about authentication.
 * No cookies, no JWTs, no Supabase — those are infrastructure concerns.
 */
export interface IdentityGateway {
  getActor(): Promise<Actor | null>;
  listActiveStaff(): Promise<StaffProfile[]>;
  updateOwnProfile(input: { fullName: string | null; jobTitle: string | null }): Promise<void>;
}
