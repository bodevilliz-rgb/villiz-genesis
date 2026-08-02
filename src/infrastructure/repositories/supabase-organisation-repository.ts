import "server-only";
import type {
  OrganisationRepository,
  OrganisationWriteModel,
} from "@/core/application/ports/organisation-port";
import type { Organisation, OrganisationMember, OrganisationSummary } from "@/core/domain/entities/organisation";
import type { OrganisationRole } from "@/core/domain/entities/identity";
import type { GenesisClient } from "../supabase/server-client";
import { toOrganisation, toOrganisationMember } from "../mappers/organisation-mapper";
import { translateError, unwrap } from "./errors";

const ORGANISATION_COLUMNS = "*";

export class SupabaseOrganisationRepository implements OrganisationRepository {
  constructor(
    private readonly client: GenesisClient,
    private readonly actorId: string,
  ) {}

  /**
   * One round trip for the whole portfolio. RLS restricts the result set to the
   * organisations this employee is assigned to (or all of them, for platform
   * admins) — there is no client-side filter to get wrong.
   */
  async listForActor(): Promise<OrganisationSummary[]> {
    const { data, error } = await this.client
      .from("organisations")
      .select(
        `*,
         organisation_members(profile_id, role),
         membrain_entries(count)`,
      )
      .order("name", { ascending: true });

    if (error) translateError(error, "Organisation list");

    return (data ?? []).map((row) => {
      const members = (row.organisation_members ?? []) as Array<{ profile_id: string; role: OrganisationRole }>;
      const counts = (row.membrain_entries ?? []) as Array<{ count: number }>;
      return {
        ...toOrganisation(row),
        viewerRole: members.find((m) => m.profile_id === this.actorId)?.role ?? null,
        memberCount: members.length,
        membrainEntryCount: counts[0]?.count ?? 0,
      };
    });
  }

  async findById(id: string): Promise<Organisation | null> {
    const { data, error } = await this.client
      .from("organisations")
      .select(ORGANISATION_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) translateError(error, "Organisation");
    return data ? toOrganisation(data) : null;
  }

  async slugExists(slug: string, excludeId?: string): Promise<boolean> {
    let query = this.client.from("organisations").select("id").eq("slug", slug).limit(1);
    if (excludeId) query = query.neq("id", excludeId);

    const { data, error } = await query;
    if (error) translateError(error, "Slug check");
    return (data ?? []).length > 0;
  }

  async create(input: OrganisationWriteModel & { createdBy: string }): Promise<Organisation> {
    const result = await this.client
      .from("organisations")
      .insert({
        name: input.name,
        slug: input.slug,
        legal_name: input.legalName,
        industry: input.industry,
        website_url: input.websiteUrl,
        status: input.status,
        brand_colour: input.brandColour,
        primary_contact_name: input.primaryContactName,
        primary_contact_email: input.primaryContactEmail,
        notes: input.notes,
        // onboarded_at is stamped by the organisations_stamp_onboarded_at trigger.
        created_by: input.createdBy,
      })
      .select(ORGANISATION_COLUMNS)
      .single();

    return toOrganisation(unwrap(result, "Organisation"));
  }

  async update(id: string, input: OrganisationWriteModel): Promise<Organisation> {
    const result = await this.client
      .from("organisations")
      .update({
        name: input.name,
        slug: input.slug,
        legal_name: input.legalName,
        industry: input.industry,
        website_url: input.websiteUrl,
        status: input.status,
        brand_colour: input.brandColour,
        primary_contact_name: input.primaryContactName,
        primary_contact_email: input.primaryContactEmail,
        notes: input.notes,
      })
      .eq("id", id)
      .select(ORGANISATION_COLUMNS)
      .single();

    return toOrganisation(unwrap(result, "Organisation"));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.from("organisations").delete().eq("id", id);
    if (error) translateError(error, "Organisation delete");
  }

  async listMembers(organisationId: string): Promise<OrganisationMember[]> {
    // `organisation_members` has two foreign keys into `profiles`
    // (profile_id — the member's own identity — and assigned_by — an audit
    // trail of who granted the membership), so PostgREST can't infer which
    // one `profiles(...)` should embed without this explicit hint. The
    // member's own identity (organisation_members_profile_id_fkey) is what
    // this method — and the domain mapping in toOrganisationMember, which
    // reads the embed back under the unchanged `profiles` key — expects.
    const { data, error } = await this.client
      .from("organisation_members")
      .select(
        `*, profiles!organisation_members_profile_id_fkey(id, email, full_name, avatar_url, job_title, is_active, role)`,
      )
      .eq("organisation_id", organisationId);

    if (error) translateError(error, "Team list");
    return (data ?? []).map((row) => toOrganisationMember(row as never));
  }

  async viewerRole(organisationId: string): Promise<OrganisationRole | null> {
    const { data, error } = await this.client
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", organisationId)
      .eq("profile_id", this.actorId)
      .maybeSingle();

    if (error) translateError(error, "Role lookup");
    return data?.role ?? null;
  }

  async assignMember(input: {
    organisationId: string;
    profileId: string;
    role: OrganisationRole;
    assignedBy: string;
  }): Promise<void> {
    const { error } = await this.client.from("organisation_members").upsert(
      {
        organisation_id: input.organisationId,
        profile_id: input.profileId,
        role: input.role,
        assigned_by: input.assignedBy,
      },
      { onConflict: "organisation_id,profile_id" },
    );

    if (error) translateError(error, "Team assignment");
  }

  async removeMember(organisationId: string, profileId: string): Promise<void> {
    const { error } = await this.client
      .from("organisation_members")
      .delete()
      .eq("organisation_id", organisationId)
      .eq("profile_id", profileId);

    if (error) translateError(error, "Team removal");
  }
}
